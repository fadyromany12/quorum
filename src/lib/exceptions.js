/* Attendance exceptions — where the roster and the clock disagree.

   Pure, no I/O. The inputs are what was scheduled, what was actually punched,
   and what was already excused; the output is a list of discrepancies with the
   matrix rule each one would be logged under.

   ── The thing this module is really about ─────────────────────────────────

   Every exception here becomes a disciplinary case if someone acts on it, so a
   false positive is not a cosmetic bug — it is an unjust warning against a real
   person, delivered with the authority of a system. The whole design follows
   from that:

     1. Silence beats a guess. Every classifier can return "cannot tell", and
        does so whenever the evidence is incomplete. A day with no roster row is
        not an absence; it is a day we do not know about.

     2. Excused is checked before absent. An agent on approved annual leave has
        no login and no shift, which looks exactly like an NCNS to anything that
        only compares two tables. Approved leave is therefore a required input
        rather than an optional refinement — `exceptionsFor` refuses to classify
        a missing day when it has not been told what was approved.

     3. Nothing is judged before it has finished. "Left early" for someone
        halfway through their shift is not an early departure, it is the middle
        of the afternoon. Anything measured against the end of a shift waits for
        the shift to end.

     4. It proposes, it does not decide. Each exception names a matrix rule, and
        that is a suggestion for the human who opens the case — not a verdict,
        not a count, and never something applied automatically. The occurrence
        maths lives in the engine and stays there. */

import { AUX_CODES, ATTENDANCE_POLICY, adherence, breaches, localDay } from "./attendance.js";
import { SCHEDULE_ACTIVITIES, minutesOf } from "./schedule.js";

export const DEFAULT_TZ = "Africa/Cairo";

/**
 * The instant a local calendar day begins, in a named zone.
 *
 * Found by search rather than by adding a stored offset, because Egypt observes
 * DST again and the offset is not a constant. The predicate is the fiddly part
 * and got it wrong once: "this instant is on that local day" is true for the
 * whole twenty-four hours, so taking the first match returned mid-afternoon.
 * Midnight is the instant that is on the day when the minute before it is not.
 *
 * @returns {number|null} epoch ms, or null if the date is unparseable
 */
export function localMidnight(date, timeZone = DEFAULT_TZ) {
  const base = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(base)) return null;
  for (let h = -14; h <= 14; h++) {
    const c = base + h * 3600_000;
    if (localDay(c, timeZone) === date && localDay(c - 60_000, timeZone) !== date) return c;
  }
  return null;
}

/**
 * A rostered shift as a pair of instants.
 *
 * A shift is instants rather than clock times for the reason overnight shifts
 * and DST exist: 22:00–06:00 is not "before" 06:00, and eight hours from 23:00
 * does not always land at 07:00.
 */
export function shiftWindow(date, startTime, durationMinutes, timeZone = DEFAULT_TZ) {
  const start = minutesOf(startTime);
  if (!Number.isFinite(start) || !durationMinutes) return null;
  const midnight = localMidnight(date, timeZone);
  if (midnight === null) return null;
  const s = midnight + start * 60_000;
  return { start: s, end: s + durationMinutes * 60_000 };
}

/** How long after a shift ends before leaving counts as leaving early. */
export const EARLY_LEAVE_GRACE_SECONDS = 5 * 60;

/* Each kind of discrepancy, and the matrix rule it would be logged under. The
   ids are DCM rule ids — kept as ids rather than names so a renamed violation
   does not silently stop matching. */
export const EXCEPTION_KINDS = {
  noShow: {
    label: "No show",
    violationId: "ncns",
    why: "Scheduled to work, never logged in, and no approved leave covering the day.",
  },
  late: {
    label: "Late",
    violationId: "late",
    why: "First presence after the shift start, beyond the grace period.",
  },
  leftEarly: {
    label: "Left early",
    violationId: "floor",
    why: "Last presence before the end of the scheduled shift.",
  },
  unscheduled: {
    label: "Worked unscheduled",
    violationId: "offhours",
    why: "Logged in on a day with no shift on the roster.",
  },
  overBreak: {
    label: "Over break",
    violationId: "break",
    why: "A break ran past the limit for that AUX code.",
  },
  tooManyBreaks: {
    label: "Too many breaks",
    violationId: "aux",
    why: "More instances of an AUX code than the shift allows.",
  },
};

export const EXCEPTION_CODES = Object.keys(EXCEPTION_KINDS);
export const isExceptionKind = (k) => Object.hasOwn(EXCEPTION_KINDS, k);

const secs = (n) => Math.max(0, Math.round(n));

/**
 * Whether an approved-leave record covers a date.
 *
 * Inclusive at both ends, because a leave request for "the 3rd to the 5th"
 * means all three days to everyone who has ever filled one in.
 */
export const leaveCovers = (leave, date) =>
  !!leave && String(leave.from) <= String(date) && String(date) <= String(leave.to);

/**
 * Exceptions for one person on one day.
 *
 * @param {object} input
 * @param {string} input.date              the local calendar day, yyyy-mm-dd
 * @param {object|null} input.scheduled    the roster row, or null if none
 * @param {{start: number, end: number}|null} input.shift  the scheduled window as instants
 * @param {Array<object>} input.intervals  attendance intervals for the day
 * @param {Array<object>} input.approvedLeave  approved leave overlapping the day
 * @param {number} input.nowMs             so nothing unfinished is judged
 * @returns {{exceptions: Array<object>, undetermined: string[]}}
 */
export function exceptionsFor({
  date,
  scheduled = null,
  shift = null,
  intervals = [],
  approvedLeave = null,
  nowMs = Date.now(),
  policy = ATTENDANCE_POLICY,
}) {
  const out = [];
  const undetermined = [];
  const add = (kind, detail) => out.push({ kind, date, ...EXCEPTION_KINDS[kind], ...detail });

  /* `approvedLeave` must be supplied — as an array, even an empty one. Left
     undefined it would be indistinguishable from "no leave", and the difference
     between those two is the difference between a correct NCNS and an unjust
     one. */
  if (approvedLeave === null || approvedLeave === undefined) {
    return { exceptions: [], undetermined: ["Approved leave was not supplied, so absence cannot be judged."] };
  }

  const excused = approvedLeave.some((l) => leaveCovers(l, date));
  const paidPresence = intervals.filter((i) => AUX_CODES[i.aux]?.paid);
  const worked = paidPresence.length > 0;

  /* A roster row that does not put the person on the floor — a day off, leave,
     a training day — is not a shift to be measured against. */
  const covers = scheduled ? !!SCHEDULE_ACTIVITIES[scheduled.activity]?.covers : false;

  // ── Nothing scheduled ──────────────────────────────────────────────────
  if (!scheduled) {
    if (worked) add("unscheduled", { minutes: Math.round(paidPresence.reduce((n, i) => n + i.seconds, 0) / 60) });
    /* No roster row and no login is not an absence. It is a day the roster does
       not describe, and treating it as absence would flag every unrostered
       person every day. */
    else undetermined.push("No shift on the roster for this day.");
    return { exceptions: out, undetermined };
  }

  if (!covers) {
    // Rostered off, on leave or in training: working is worth surfacing, not absence.
    if (worked && !excused) {
      add("unscheduled", { minutes: Math.round(paidPresence.reduce((n, i) => n + i.seconds, 0) / 60), activity: scheduled.activity });
    }
    return { exceptions: out, undetermined };
  }

  // ── Scheduled to be on the floor ───────────────────────────────────────
  if (!worked) {
    if (excused) return { exceptions: out, undetermined };
    /* Only once the shift has started. Flagging a no-show at 6am for a 2pm
       shift is the most obviously wrong thing this module could do. */
    if (!shift) {
      /* Distinct from "not started". Saying the shift has not started when the
         window could not be resolved sends the lead to look at the clock when
         the problem is the roster row. */
      undetermined.push("The shift window could not be resolved from the roster row.");
      return { exceptions: out, undetermined };
    }
    if (nowMs < shift.start) {
      undetermined.push("The shift has not started yet.");
      return { exceptions: out, undetermined };
    }
    add("noShow", { scheduledStart: scheduled.startTime ?? null });
    return { exceptions: out, undetermined };
  }

  if (!shift) {
    undetermined.push("The shift window could not be resolved, so lateness cannot be measured.");
    return { exceptions: out, undetermined };
  }

  const adh = adherence(intervals, shift);

  // Late: first paid presence after the start, past the grace.
  if (Number.isFinite(adh.lateBySeconds) && adh.lateBySeconds > policy.lateGraceSeconds) {
    add("late", { bySeconds: secs(adh.lateBySeconds), adherencePct: adh.adherencePct });
  }

  /* Left early: only once the shift is over. Before that the agent is simply
     still working, and the last punch we can see is not the last one there
     will be. */
  if (nowMs >= shift.end) {
    const lastPresence = Math.max(...paidPresence.map((i) => i.to));
    const shortBy = Math.floor((shift.end - lastPresence) / 1000);
    if (shortBy > EARLY_LEAVE_GRACE_SECONDS) {
      add("leftEarly", { bySeconds: secs(shortBy), adherencePct: adh.adherencePct });
    }
  }

  // AUX breaches — the existing rules, re-badged as exceptions.
  for (const b of breaches(intervals)) {
    if (b.kind === "over_limit") {
      add("overBreak", { aux: b.aux, overBySeconds: secs(b.overBy), limitSeconds: b.limitSeconds });
    } else if (b.kind === "too_many") {
      add("tooManyBreaks", { aux: b.aux, count: b.count, maxPerShift: b.maxPerShift });
    }
  }

  return { exceptions: out, undetermined };
}

/**
 * Roll a day's worth of people up into one list, worst first.
 *
 * The order is by how much explaining each one needs, not alphabetical: a
 * no-show is the thing a lead must act on this morning, and an over-run break
 * is something to mention at the one-to-one.
 */
export const EXCEPTION_WEIGHT = {
  noShow: 100,
  leftEarly: 60,
  late: 50,
  unscheduled: 40,
  tooManyBreaks: 20,
  overBreak: 10,
};

export function rankExceptions(rows) {
  return [...rows].sort((a, b) => {
    const w = (EXCEPTION_WEIGHT[b.kind] ?? 0) - (EXCEPTION_WEIGHT[a.kind] ?? 0);
    if (w) return w;
    return String(a.employeeName ?? "").localeCompare(String(b.employeeName ?? ""));
  });
}

/**
 * A one-line summary of a day, for the screen's header.
 * Counts people rather than exceptions — one agent with three over-runs is one
 * conversation, not three.
 */
export function summariseDay(rows) {
  const byKind = {};
  const people = new Set();
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    if (r.employeeId) people.add(r.employeeId);
  }
  return { total: rows.length, people: people.size, byKind };
}

/**
 * Everything wrong with this module's own wiring — a kind that names a matrix
 * rule the DCM does not define, or a weight for a kind that does not exist.
 *
 * Exists because the link between an exception and its violation is a string
 * that nothing else checks: rename a DCM rule and the "log this" button quietly
 * stops pre-selecting anything, which looks like a UI glitch rather than a
 * broken mapping.
 *
 * @param {Array<{id: string}>} dcm
 * @returns {string[]} empty when sound
 */
export function checkExceptions(dcm = []) {
  const problems = [];
  const ids = new Set(dcm.map((r) => r.id));
  for (const [kind, meta] of Object.entries(EXCEPTION_KINDS)) {
    if (!meta.label || !meta.why) problems.push(`${kind} is missing its label or explanation.`);
    if (!meta.violationId) problems.push(`${kind} names no matrix rule.`);
    else if (ids.size && !ids.has(meta.violationId)) {
      problems.push(`${kind} points at matrix rule "${meta.violationId}", which the DCM does not define.`);
    }
    if (!Number.isFinite(EXCEPTION_WEIGHT[kind])) problems.push(`${kind} has no ranking weight, so it would sort last.`);
  }
  for (const kind of Object.keys(EXCEPTION_WEIGHT)) {
    if (!isExceptionKind(kind)) problems.push(`Weight defined for unknown kind "${kind}".`);
  }
  return problems;
}

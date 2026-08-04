/* Schedules — turning a roster of people into coverage per interval. Pure.

   wfm.js answers "how many are needed at 11:00". This answers "how many are
   actually rostered at 11:00", which is the harder half, because a shift is not
   a block of availability:

     · Breaks and meals come out of it, and the agent is not on the queue during
       them. A tool that counts an eight-hour shift as eight hours of coverage
       over-states every afternoon by about an hour per head, which is precisely
       the interval planners get wrong by hand.
     · Training, meetings and leave are scheduled activities that occupy the
       person without covering the queue. They belong on the roster — that is
       how shrinkage becomes a measurement rather than a guess — but they
       contribute nothing to coverage.
     · Shifts cross midnight. A 22:00 shift of nine hours covers intervals on
       two calendar days, and the day it is filed under is the day it started.

   ── Where breaks are placed ────────────────────────────────────────────────
   Break placement is a real scheduling problem and this does not pretend to
   solve it. Rather than inventing a placement the roster does not contain, the
   break minutes are spread evenly across the shift's middle as a fractional
   reduction. That is honest about being an approximation, it is stable (the
   same shift always yields the same curve), and it never claims someone is on
   the queue for time they are not.

   The consequence to accept: coverage at a single interval can read 12.5 rather
   than 13. Fractional coverage is correct — half the interval with a break in
   it genuinely is half-covered — and rounding it away is how a half-hour of
   understaffing disappears from a report. */

import { intervalLabel, DEFAULT_INTERVAL, intervalsPerDay, coverage } from "./wfm.js";

/**
 * What a person can be scheduled to do.
 *
 * `covers` is the only field that decides coverage. `paid` and `shrinkage`
 * exist because the same row has to answer two other questions — what it costs
 * and why the queue was short — and deriving those from a second list is how
 * the two answers drift apart.
 */
export const SCHEDULE_ACTIVITIES = {
  Shift: { label: "Shift", labelAr: "وردية", covers: true, paid: true, shrinkage: false },
  Overtime: { label: "Overtime", labelAr: "وقت إضافي", covers: true, paid: true, shrinkage: false, premium: true },
  Training: { label: "Training", labelAr: "تدريب", covers: false, paid: true, shrinkage: true },
  Meeting: { label: "Meeting", labelAr: "اجتماع", covers: false, paid: true, shrinkage: true },
  Coaching: { label: "Coaching", labelAr: "جلسة توجيه", covers: false, paid: true, shrinkage: true },
  Leave: { label: "Leave", labelAr: "إجازة", covers: false, paid: true, shrinkage: true },
  /* Off is a row, not an absence of one. "Nobody scheduled them" and "they are
     off" are different states and only the first is a mistake. */
  Off: { label: "Day off", labelAr: "يوم راحة", covers: false, paid: false, shrinkage: false },
};

export const ACTIVITY_LIST = Object.keys(SCHEDULE_ACTIVITIES);
export const isScheduleActivity = (a) => Object.hasOwn(SCHEDULE_ACTIVITIES, a);
export const coveringActivities = () => ACTIVITY_LIST.filter((a) => SCHEDULE_ACTIVITIES[a].covers);

/** Minutes past midnight for "HH:MM". NaN when unparseable. */
export function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

/**
 * The intervals a shift touches, with how much of each it occupies.
 *
 * Returns fractions rather than booleans because a shift starting at 09:10 in a
 * 30-minute grid covers two thirds of the 09:00 interval, and calling that a
 * whole interval is how a schedule appears to cover more than it does.
 *
 * Intervals past midnight are returned with `nextDay: true` rather than being
 * silently folded back to the start of the same day.
 *
 * @param {string} startTime "HH:MM"
 * @param {number} durationMinutes
 * @param {number} [width] interval width in minutes
 * @returns {Array<{interval: string, fraction: number, nextDay: boolean}>}
 */
export function intervalsCovered(startTime, durationMinutes, width = DEFAULT_INTERVAL) {
  const start = minutesOf(startTime);
  const dur = Math.max(0, Number(durationMinutes) || 0);
  if (!Number.isFinite(start) || dur === 0) return [];

  const perDay = intervalsPerDay(width);
  const out = [];
  const firstIndex = Math.floor(start / width);
  const lastIndex = Math.floor((start + dur - 1) / width);

  for (let i = firstIndex; i <= lastIndex; i++) {
    const from = i * width;
    const to = from + width;
    const overlap = Math.min(to, start + dur) - Math.max(from, start);
    if (overlap <= 0) continue;
    out.push({
      interval: intervalLabel(i % perDay, width),
      fraction: overlap / width,
      nextDay: i >= perDay,
    });
  }
  return out;
}

/**
 * One roster row's contribution to coverage, break time removed.
 *
 * Break minutes are taken off the middle of the shift as an even fraction —
 * see the file header for why this approximation is preferred to inventing a
 * placement the roster does not contain.
 *
 * @param {{activity?: string, startTime: string, durationMinutes: number,
 *          paidBreakMinutes?: number, unpaidBreakMinutes?: number}} row
 * @param {number} [width]
 * @returns {Array<{interval: string, agents: number, nextDay: boolean}>}
 */
export function coverageOf(row, width = DEFAULT_INTERVAL) {
  const activity = row.activity ?? "Shift";
  if (!SCHEDULE_ACTIVITIES[activity]?.covers) return [];

  const dur = Math.max(0, Number(row.durationMinutes) || 0);
  if (dur === 0) return [];
  const breaks = Math.max(0, Number(row.paidBreakMinutes) || 0) + Math.max(0, Number(row.unpaidBreakMinutes) || 0);
  // A shift whose breaks exceed its length is a data error; treating it as zero
  // coverage is safer than letting it subtract negative time.
  const onQueue = Math.max(0, dur - breaks);
  const factor = dur === 0 ? 0 : onQueue / dur;

  return intervalsCovered(row.startTime, dur, width).map((i) => ({
    interval: i.interval,
    agents: i.fraction * factor,
    nextDay: i.nextDay,
  }));
}

/**
 * Scheduled agents per interval for a whole roster.
 *
 * @param {Array<object>} rows schedule entries, each with startTime/durationMinutes
 * @param {number} [width]
 * @returns {Record<string, number>} interval label -> agents (fractional)
 */
export function scheduledByInterval(rows, width = DEFAULT_INTERVAL) {
  const out = {};
  for (const r of rows ?? []) {
    for (const c of coverageOf(r, width)) {
      out[c.interval] = (out[c.interval] ?? 0) + c.agents;
    }
  }
  return out;
}

/**
 * Paid and worked minutes for a roster row — the payroll side of the same data.
 *
 * Unpaid meal time is removed and paid breaks are not, which is the whole point
 * of keeping them as separate fields: conflating them overstates the paybill by
 * roughly the meal break on every shift.
 *
 * @returns {{paidMinutes: number, onQueueMinutes: number, premium: boolean}}
 */
export function payableMinutes(row) {
  const meta = SCHEDULE_ACTIVITIES[row.activity ?? "Shift"];
  if (!meta?.paid) return { paidMinutes: 0, onQueueMinutes: 0, premium: false };
  const dur = Math.max(0, Number(row.durationMinutes) || 0);
  const unpaid = Math.max(0, Number(row.unpaidBreakMinutes) || 0);
  const paidBreak = Math.max(0, Number(row.paidBreakMinutes) || 0);
  const paidMinutes = Math.max(0, dur - unpaid);
  return {
    paidMinutes,
    onQueueMinutes: Math.max(0, dur - unpaid - paidBreak),
    premium: !!meta.premium,
  };
}

/**
 * Shrinkage implied by the roster itself, in the shape shrinkageFrom() takes.
 *
 * This is the bridge that makes shrinkage a measurement: the hours lost to
 * training, meetings and leave are already on the schedule, so nobody has to
 * remember a percentage.
 */
export function shrinkageInputs(rows) {
  let paidHours = 0, trainingHours = 0, meetingHours = 0, leaveHours = 0, breakHours = 0;
  for (const r of rows ?? []) {
    const meta = SCHEDULE_ACTIVITIES[r.activity ?? "Shift"];
    if (!meta) continue;
    const { paidMinutes } = payableMinutes(r);
    paidHours += paidMinutes / 60;
    if (meta.covers) breakHours += Math.max(0, Number(r.paidBreakMinutes) || 0) / 60;
    else if (r.activity === "Training" || r.activity === "Coaching") trainingHours += paidMinutes / 60;
    else if (r.activity === "Meeting") meetingHours += paidMinutes / 60;
    else if (r.activity === "Leave") leaveHours += paidMinutes / 60;
  }
  return { paidHours, trainingHours, meetingHours, leaveHours, breakHours };
}

/**
 * Turn a shift pattern into a schedule entry for one person on one day.
 *
 * The pattern's times are copied rather than referenced. A published roster is
 * a promise about specific hours, and editing a pattern next quarter must not
 * silently rewrite what someone was told to work last month.
 */
export function entryFromPattern(pattern, employeeId, date, overrides = {}) {
  return {
    employeeId,
    date,
    activity: "Shift",
    startTime: pattern?.startTime ?? "",
    durationMinutes: pattern?.durationMinutes ?? 0,
    paidBreakMinutes: pattern?.paidBreakMinutes ?? 0,
    unpaidBreakMinutes: pattern?.unpaidBreakMinutes ?? 0,
    patternId: pattern?.id ?? null,
    published: false,
    ...overrides,
  };
}

/**
 * Everything wrong with a roster row, as sentences.
 *
 * Rejected rather than accepted-and-flagged, because a schedule is published to
 * the people who plan their week around it. A shift with no start time is not a
 * warning; it is a row that cannot be worked.
 *
 * @returns {string[]} empty when the row is publishable
 */
export function checkEntry(row) {
  const problems = [];
  const activity = row?.activity ?? "Shift";
  if (!isScheduleActivity(activity)) problems.push(`"${activity}" is not a scheduled activity.`);
  if (!row?.employeeId) problems.push("The row is not attached to anyone.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row?.date ?? ""))) problems.push("The date is not a calendar day.");

  const needsHours = SCHEDULE_ACTIVITIES[activity]?.paid;
  if (needsHours) {
    if (!Number.isFinite(minutesOf(row?.startTime))) problems.push("The start time is not a clock time.");
    const dur = Number(row?.durationMinutes);
    if (!Number.isFinite(dur) || dur <= 0) problems.push("The shift has no length.");
    else if (dur > 16 * 60) problems.push("The shift is longer than 16 hours — check the units are minutes.");
    const breaks = (Number(row?.paidBreakMinutes) || 0) + (Number(row?.unpaidBreakMinutes) || 0);
    if (breaks >= dur && dur > 0) problems.push("The breaks are longer than the shift.");
  }
  return problems;
}

/**
 * Rows that overlap for the same person on the same day.
 *
 * A split shift is legitimate, so overlap rather than count is what is checked —
 * two rows are a problem only when they claim the same minutes, which means
 * either a double-booking or a copy of a row that was meant to replace it.
 *
 * @returns {Array<{employeeId: string, date: string, a: object, b: object}>}
 */
export function findClashes(rows) {
  const byPerson = new Map();
  for (const r of rows ?? []) {
    if (!SCHEDULE_ACTIVITIES[r.activity ?? "Shift"]?.paid) continue;
    const key = `${r.employeeId}|${r.date}`;
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key).push(r);
  }
  const clashes = [];
  for (const [key, list] of byPerson) {
    const spans = list
      .map((r) => ({ row: r, from: minutesOf(r.startTime), to: minutesOf(r.startTime) + (Number(r.durationMinutes) || 0) }))
      .filter((s) => Number.isFinite(s.from))
      .sort((a, b) => a.from - b.from);
    for (let i = 1; i < spans.length; i++) {
      if (spans[i].from < spans[i - 1].to) {
        const [employeeId, date] = key.split("|");
        clashes.push({ employeeId, date, a: spans[i - 1].row, b: spans[i].row });
      }
    }
  }
  return clashes;
}

/* ── What one absence does to the plan ──────────────────────────────────────

   The question an approver is actually answering when they look at a leave
   request is "can we cover this day without them", and until now the honest
   answer has been a guess. The roster already contains the person, so the exact
   answer is available: recompute coverage with their rows removed and look at
   the intervals they would have been covering.

   Two things this is careful not to be:

     · It is not a veto. Annual leave is a statutory entitlement under Egyptian
       Labour Law, and a staffing model does not get to overrule it. The verdict
       is advice attached to a decision a human still makes — which is why the
       return value is a sentence and a tightest interval rather than a boolean
       the UI could quietly wire to a disabled button.

     · It does not blame the requester for a gap that already exists. An
       interval short before the request is short regardless of the answer, and
       reporting it as the request's impact would teach approvers to ignore the
       warning entirely. Those are reported separately. */

/**
 * @param {object} p
 * @param {Array<{interval: string, rostered: number}>} p.plan the day's requirement
 * @param {Array<object>} p.roster every schedule row for the day, including theirs
 * @param {string} p.employeeId who would be absent
 * @param {number} [p.width]
 * @returns {{affected: string[], tightest: object|null, wouldBeShort: object[],
 *            alreadyShort: string[], causedByThis: number, verdict: string, coverable: boolean}}
 */
export function absenceImpact({ plan, roster, employeeId, width = 30 }) {
  const all = roster ?? [];
  const theirs = all.filter((r) => r.employeeId === employeeId);
  const affected = [...new Set(theirs.flatMap((r) => coverageOf(r, width).map((c) => c.interval)))].sort();

  const before = coverage(plan, scheduledByInterval(all, width));
  const after = coverage(plan, scheduledByInterval(all.filter((r) => r.employeeId !== employeeId), width));

  const alreadyShort = before.rows.filter((r) => r.state === "under" && affected.includes(r.interval)).map((r) => r.interval);
  const wouldBeShort = after.rows.filter((r) => r.state === "under" && affected.includes(r.interval));
  /* Intervals this specific absence pushes under — the ones the approver can
     still do something about by moving the day. */
  const causedByThis = wouldBeShort.filter((r) => !alreadyShort.includes(r.interval)).length;
  const tightest = affected.length
    ? after.rows.filter((r) => affected.includes(r.interval)).reduce((w, r) => (w === null || r.difference < w.difference ? r : w), null)
    : null;

  let verdict;
  if (affected.length === 0) verdict = "They are not rostered on the queue that day, so cover is unaffected.";
  else if (causedByThis === 0 && wouldBeShort.length === 0) {
    verdict = `Covered without them — ${tightest.interval} is the tightest at ${Math.round(tightest.difference * 10) / 10} spare.`;
  } else if (causedByThis === 0) {
    verdict = `${wouldBeShort.length} of their intervals are already short before this request; approving it does not make any interval short that was not already.`;
  } else {
    verdict = `Approving leaves ${causedByThis} interval${causedByThis === 1 ? "" : "s"} short that would otherwise be covered — worst is ${tightest.interval}, ${Math.round(-tightest.difference * 10) / 10} under.`;
  }

  return {
    affected,
    tightest,
    wouldBeShort,
    alreadyShort,
    causedByThis,
    verdict,
    coverable: causedByThis === 0,
  };
}

/* ── Bulk application ───────────────────────────────────────────────────────

   Building a month's roster one cell at a time is why rosters get built in
   Excel and pasted in. This is the same operation the grid performs, expanded
   across a set of people and a span of days.

   Pure, and separated from the screen, because the arithmetic is where this
   goes wrong: an off-by-one on the range writes a Saturday nobody works, and a
   weekday filter applied in the wrong time zone shifts an entire month by a
   day. Both are the kind of mistake that is invisible in a preview count and
   obvious to the forty people who turn up. */

/** Weekday indices as JavaScript reports them, named for the roster UI. */
export const WEEKDAYS = [
  { index: 0, short: "Sun", label: "Sunday" },
  { index: 1, short: "Mon", label: "Monday" },
  { index: 2, short: "Tue", label: "Tuesday" },
  { index: 3, short: "Wed", label: "Wednesday" },
  { index: 4, short: "Thu", label: "Thursday" },
  { index: 5, short: "Fri", label: "Friday" },
  { index: 6, short: "Sat", label: "Saturday" },
];

/**
 * The dates in an inclusive range whose weekday is selected.
 *
 * Compared as UTC throughout. A yyyy-mm-dd string is a calendar date with no
 * zone, and running it through a local Date makes the weekday depend on where
 * the server happens to be — which is how a roster comes out shifted by one day
 * for everybody.
 *
 * @param {string} from yyyy-mm-dd, inclusive
 * @param {string} to   yyyy-mm-dd, inclusive
 * @param {number[]} weekdays 0–6, Sunday first; empty means every day
 * @returns {string[]}
 */
export function datesInRange(from, to, weekdays = []) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const wanted = weekdays.length ? new Set(weekdays) : null;
  const out = [];
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t);
    if (wanted && !wanted.has(d.getUTCDay())) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** The most rows one request may carry — the API refuses more. */
export const BULK_LIMIT = 500;

/**
 * Expand a bulk selection into roster rows, and say what is wrong with it.
 *
 * Returns the rows *and* the problems rather than throwing, because the caller
 * is a preview: the point is to show someone what 240 rows would look like
 * before they write any of them.
 *
 * @returns {{rows: object[], problems: string[], days: string[]}}
 */
export function bulkRows({ employeeIds = [], from, to, weekdays = [], pattern = null, activity = "Shift", note = "" }) {
  const problems = [];
  const days = datesInRange(from, to, weekdays);

  if (!employeeIds.length) problems.push("Nobody is selected.");
  if (!days.length) {
    problems.push(
      weekdays.length
        ? "No days in that range fall on the selected weekdays."
        : "That date range is empty or runs backwards.",
    );
  }

  const covers = !!SCHEDULE_ACTIVITIES[activity]?.covers;
  /* A covering activity needs a shape to be worked. A day off does not, and
     demanding a pattern for one would make "give everyone Friday off" require
     inventing a shift. */
  if (covers && !pattern) problems.push(`${activity} needs a shift pattern — pick one, or choose an activity like Off.`);

  const rows = [];
  if (!problems.length) {
    for (const employeeId of employeeIds) {
      for (const date of days) {
        rows.push(
          covers
            ? entryFromPattern(pattern, employeeId, date, { activity, note })
            : { employeeId, date, activity, startTime: "", durationMinutes: 0, patternId: null, published: false, note },
        );
      }
    }
  }

  if (rows.length > BULK_LIMIT) {
    problems.push(
      `That is ${rows.length} rows — more than the ${BULK_LIMIT} one save can carry. ` +
        "Narrow the range or the group and repeat.",
    );
  }

  return { rows, problems, days };
}

/* ── Shift swaps ────────────────────────────────────────────────────────────

   Two agents trade days. Today this happens over WhatsApp and reaches the
   roster, if at all, as a favour someone remembers to type in — which means the
   coverage model, the exceptions screen and payroll are all working from a
   roster that is quietly wrong. */

/**
 * Whether two roster rows can be exchanged, and what the result would be.
 *
 * Returns the plan rather than performing it, so the same function answers
 * "may I offer this?" on the agent's screen and "is this still true?" at
 * approval — a swap that was fine when proposed may not be by the time a lead
 * looks, because either roster row can have moved in between.
 *
 * @returns {{ok: true, rows: object[]} | {ok: false, reason: string}}
 */
export function swapPlan(a, b) {
  if (!a || !b) return { ok: false, reason: "Both shifts must still be on the roster." };
  if (a.employeeId === b.employeeId) return { ok: false, reason: "That is the same person's shift." };
  if (a.date === b.date && a.startTime === b.startTime) {
    return { ok: false, reason: "Those two shifts are identical — swapping them changes nothing." };
  }
  for (const [row, who] of [[a, "Your"], [b, "Their"]]) {
    if (!SCHEDULE_ACTIVITIES[row.activity]?.covers) {
      return { ok: false, reason: `${who} ${String(row.activity ?? "entry").toLowerCase()} is not a shift that can be swapped.` };
    }
  }

  /* The shape moves with the shift, not with the person: a swap means each
     agent works the other's day, so the start time, duration and pattern travel
     across and the dates stay put. Exchanging the dates instead would leave
     each agent on their own shift on a different day, which is a different
     request nobody made. */
  return {
    ok: true,
    rows: [
      { ...a, employeeId: b.employeeId },
      { ...b, employeeId: a.employeeId },
    ],
  };
}

/**
 * Everything wrong with a proposed swap, including what it does to coverage.
 *
 * Coverage is a warning rather than a refusal. Two agents trading a Tuesday for
 * a Thursday is their business; leaving Thursday two short is the lead's, and
 * the lead is the one approving. Refusing outright would push the swap back to
 * WhatsApp, which is the situation this replaces.
 *
 * @returns {{problems: string[], warnings: string[]}}
 */
export function checkSwap(a, b, { plan = null, roster = [], width = 30 } = {}) {
  const problems = [];
  const warnings = [];
  const p = swapPlan(a, b);
  if (!p.ok) return { problems: [p.reason], warnings };

  /* A clash is a refusal, not a warning: an agent cannot be on two shifts at
     once, and a roster that says otherwise is one nobody can work. */
  const others = roster.filter((r) => r.id !== a.id && r.id !== b.id);
  const clashes = findClashes([...others, ...p.rows]);
  for (const c of clashes) problems.push(c.reason ?? "That would double-book someone.");

  if (plan) {
    for (const row of p.rows) {
      const cover = coverageOf(row, width);
      if (!cover.length) warnings.push(`${row.date} has no covered intervals after the swap.`);
    }
  }
  return { problems, warnings };
}

/* ── Overtime ───────────────────────────────────────────────────────────────

   The loop this closes: an overtime request could be raised and approved and
   nothing happened. The payslip pays overtime by reading roster rows whose
   activity is "Overtime", so an approval that never became a row was an
   approval payroll never heard about — the agent worked the hours, the manager
   said yes, and the money did not move. */

/** Hours are stored on the request; the roster works in minutes. */
const HOURS_TO_MINUTES = 60;

/**
 * The roster row an approved overtime request becomes, or null.
 *
 * @param {object} request a settled request, with steps
 * @param {number|null} grantedHours what the approvers actually allowed
 * @returns {{employeeId: string, date: string, activity: string, startTime: string,
 *            durationMinutes: number, note: string}|null}
 */
export function overtimeRow(request, grantedHours) {
  if (!request || request.type !== "overtime") return null;
  /* "partial" counts. An approver who grants two of the four hours asked for
     has approved two hours of overtime, and refusing to write the row because
     the status is not exactly "approved" would silently drop them. */
  if (request.status !== "approved" && request.status !== "partial") return null;

  const payload = request.payload ?? {};
  const date = String(payload.date ?? "");
  const startTime = String(payload.startTime ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(minutesOf(startTime))) return null;

  /* Granted, never requested. Paying what was asked for rather than what was
     allowed is the whole reason partial approval exists, and it is the error
     that costs money in the direction nobody catches. */
  const hours = Number(grantedHours ?? request.requestedUnits);
  if (!Number.isFinite(hours) || hours <= 0) return null;

  return {
    employeeId: String(request.subjectId),
    date,
    activity: "Overtime",
    startTime,
    durationMinutes: Math.round(hours * HOURS_TO_MINUTES),
    note: `Approved overtime · request ${String(request.id ?? "").slice(0, 8)}`,
  };
}

/**
 * Whether a proposed overtime block is well-formed, and why not.
 *
 * Checked before it is offered rather than at approval, because an agent who
 * types four hours starting at a time they were not working should be told
 * then, not two days later by a manager who has to work out what they meant.
 *
 * @returns {string[]} empty when it can be raised
 */
export function checkOvertime({ date, startTime, hours, shift = null } = {}) {
  const problems = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) problems.push("Pick the day the overtime was worked.");
  if (!Number.isFinite(minutesOf(startTime))) problems.push("Give a start time.");
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) problems.push("Give a number of hours greater than zero.");
  /* A ceiling, because a typo of 80 for 8 is a typo that reaches payroll. Eight
     hours of overtime in one day is already an exceptional day. */
  else if (h > 12) problems.push("More than 12 hours in one day needs to be raised with HR, not as overtime.");

  /* Overtime overlapping the shift it follows is almost always a mis-entered
     start time — the hours are already paid as the shift. */
  if (shift && Number.isFinite(minutesOf(startTime))) {
    const start = minutesOf(startTime);
    const shiftStart = minutesOf(shift.startTime);
    const shiftEnd = shiftStart + (shift.durationMinutes ?? 0);
    if (Number.isFinite(shiftStart) && start >= shiftStart && start < shiftEnd) {
      problems.push("That start time falls inside the shift you were already rostered for.");
    }
  }
  return problems;
}

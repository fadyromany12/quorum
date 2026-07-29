/* The rules engine: given an agent, a violation and a date, what does the
   matrix prescribe? Everything here is pure — no React, no storage — so the
   Log form, the Triage gate and the Agent profile all read the same verdict. */

import {
  RESET_DAYS,
  EMERGENCY_QUOTA,
  EMERGENCY_MAX_CONSECUTIVE,
  PER_INCIDENT_CAP,
  PER_MONTH_CAP,
  LAW_CITATION,
  SLA_DAYS,
} from "./constants.js";
import { todayStr, daysBetween, addDays, monthOf, yearOf, consecutiveRun, toDay } from "./dates.js";
import { deductionDaysOf, applyLaborLawCap, capNotes } from "./deductions.js";
import { days, ordinal } from "./format.js";
import { toAgentRef, agentMatches, agentKeyOf, agentLabel } from "./identity.js";

/** A case counts toward discipline only once a manager has escalated it.
    Pending-review cases are deliberately inert — that is the point of the
    triage gate — and dismissed cases never count at all. */
export const countsForDiscipline = (e) => e.stage === "active" && !e.voided;

export function statusOf(e) {
  if (e.voided) return "Voided";
  if (e.stage === "review") return "Pending review";
  if (e.stage === "dismissed") return "Dismissed";
  if (e.notified && e.opsConfirmed && (!e.hrNeeded || e.hrConfirmed)) return "Closed";
  if (e.notified && e.opsConfirmed && e.hrNeeded && !e.hrConfirmed) return "Awaiting HR";
  if (e.notified && !e.opsConfirmed) return "Awaiting OPS";
  return "Open";
}

const lastActivityAt = (e, type) => {
  const hits = (e.activity || []).filter((a) => a.type === type);
  return hits.length ? hits[hits.length - 1].at : null;
};

/**
 * How long an *open* case has been waiting in its current pipeline stage, and
 * whether that exceeds the stage's SLA target. Returns null for cases that
 * aren't waiting on anyone (closed, dismissed, voided). Time is measured from
 * when the case entered the stage — the stamped activity event, or the log
 * time as a fallback.
 */
export function slaFor(e, today = todayStr()) {
  if (e.voided || (e.stage !== "review" && e.stage !== "active")) return null;
  let sinceMs;
  let label;
  let limit;
  if (e.stage === "review") {
    sinceMs = e.createdAt;
    label = "in triage";
    limit = SLA_DAYS.review;
  } else if (!e.notified) {
    sinceMs = lastActivityAt(e, "escalated") || e.createdAt;
    label = "awaiting notify";
    limit = SLA_DAYS.notify;
  } else if (!e.opsConfirmed) {
    sinceMs = lastActivityAt(e, "notified") || e.createdAt;
    label = "awaiting OPS";
    limit = SLA_DAYS.ops;
  } else if (e.hrNeeded && !e.hrConfirmed) {
    sinceMs = lastActivityAt(e, "ops") || e.createdAt;
    label = "awaiting HR";
    limit = SLA_DAYS.hr;
  } else {
    return null; // fully closed — nobody is waiting
  }
  const ageDays = sinceMs ? Math.max(0, daysBetween(toDay(sinceMs), today)) : 0;
  return { label, ageDays, limit, warn: ageDays >= limit, breached: ageDays > limit };
}

export function findRule(dcm, { id, name }) {
  return (id && dcm.find((r) => r.id === id)) || (name && dcm.find((r) => r.name === name)) || null;
}

/**
 * Which occurrence of `violation` would an incident on `date` be?
 *
 * Warnings expire 90 days after the *previous* occurrence, so the count is a
 * chain, not a fixed window: each incident either extends the chain (gap from
 * the one before it is <= 90 days) or starts a fresh one at №1. An agent late
 * on day 0, day 80 and day 170 is on their 3rd occurrence — even though day 0
 * is 170 days back — because neither gap ever exceeded 90.
 */
export function occurrenceFor(entries, agent, violation, date, excludeId) {
  const priors = entries
    .filter(
      (e) =>
        e.id !== excludeId &&
        e.violation === violation &&
        agentMatches(e, agent) &&
        countsForDiscipline(e) &&
        e.date &&
        e.date <= date
    )
    .map((e) => e.date)
    .sort();

  let occ = 0;
  let prev = null;
  for (const d of [...priors, date]) {
    occ = prev === null || daysBetween(prev, d) > RESET_DAYS ? 1 : occ + 1;
    prev = d;
  }
  return { occ, priorDates: priors, lastPrior: priors[priors.length - 1] || null };
}

/** Emergency-leave consumption for an agent, as of `date`. */
export function emergencyUsage(entries, agent, date, excludeId) {
  const rows = entries.filter(
    (e) =>
      e.id !== excludeId &&
      e.violation === "Emergency Leave" &&
      agentMatches(e, agent) &&
      e.stage !== "dismissed" &&
      !e.voided &&
      e.date
  );

  const yearUsed = rows.filter((e) => yearOf(e.date) === yearOf(date)).length;
  const monthDates = rows.filter((e) => monthOf(e.date) === monthOf(date)).map((e) => e.date);
  const run = consecutiveRun(monthDates, date);

  const yearAfter = yearUsed + 1;
  const yearExceeded = yearAfter > EMERGENCY_QUOTA;
  const runExceeded = run > EMERGENCY_MAX_CONSECUTIVE;

  let reason = "";
  if (yearExceeded) {
    reason = `Annual emergency quota spent — this is day ${yearAfter} of ${EMERGENCY_QUOTA}. Beyond the quota, unplanned leave is unauthorised absence.`;
  } else if (runExceeded) {
    reason = `${run} consecutive emergency days this month — the limit is ${EMERGENCY_MAX_CONSECUTIVE}. Days beyond the run are unauthorised absence.`;
  }

  return {
    yearUsed,
    yearAfter,
    monthDates,
    run,
    yearExceeded,
    runExceeded,
    exceeded: yearExceeded || runExceeded,
    remaining: Math.max(0, EMERGENCY_QUOTA - yearAfter),
    reason,
  };
}

function disciplinaryVerdict(rule, agent, date, entries, dcm, excludeId) {
  const { occ, lastPrior } = occurrenceFor(entries, agent, rule.name, date, excludeId);

  // Walk back to the highest step the matrix actually defines.
  let step = Math.min(occ, 3);
  while (step > 1 && !rule["a" + step]) step--;
  const action = rule["a" + step];
  const executor = rule["e" + step] || "HR";

  const cap = applyLaborLawCap(deductionDaysOf(action), { entries, agent, date, excludeId });

  const notes = [];
  if (lastPrior) {
    notes.push(
      `Previous occurrence ${fmtGap(lastPrior, date)} — inside the ${RESET_DAYS}-day window, so the count advances. Dismissed cases are excluded.`
    );
  }
  const pending = countPendingSame(entries, agent, rule.name, date, excludeId);
  if (pending > 0) {
    notes.push(
      `${pending} earlier case${pending === 1 ? "" : "s"} of this violation still awaiting triage — not counted until escalated.`
    );
  }
  if (occ > 3 && rule.a3) {
    notes.push("Beyond the 3rd occurrence — the matrix is exhausted; escalate to HR / Practice.");
  }
  if (occ > 1 && !rule["a" + Math.min(occ, 3)]) {
    notes.push("Matrix defines no further step — the outcome follows the HR / Legal investigation.");
  }
  if (rule.severity === "Zero Tolerance") {
    notes.push("Immediate suspension pending investigation may apply; termination only after the mandatory investigation.");
  }
  if (rule.severity === "Serious" || rule.severity === "Zero Tolerance") {
    notes.push("Employee must be notified in writing, given 3–5 working days to respond, and may have a colleague present.");
  }
  if (cap.prescribed > 0) {
    notes.push(
      `${LAW_CITATION}: deductions capped at ${PER_INCIDENT_CAP} days per incident and ${PER_MONTH_CAP} days per calendar month.`
    );
    notes.push(...capNotes(cap));
  }

  return {
    disciplinary: true,
    ruleId: rule.id,
    occ,
    step,
    action,
    executor,
    severity: rule.severity,
    cap,
    resetOn: addDays(date, RESET_DAYS),
    investigation: rule.severity === "Serious" || rule.severity === "Zero Tolerance",
    notes,
  };
}

function countPendingSame(entries, agent, violation, date, excludeId) {
  return entries.filter(
    (e) =>
      e.id !== excludeId &&
      e.violation === violation &&
      agentMatches(e, agent) &&
      e.stage === "review" &&
      e.date &&
      e.date <= date
  ).length;
}

function fmtGap(from, to) {
  const n = daysBetween(from, to);
  if (n === 0) return "was the same day";
  return `was ${days(n)} ago`;
}

const NO_CAP = applyLaborLawCap(0);

/**
 * The verdict for one incident. Returns null when no violation is selected.
 *
 * `agent` is a {email, empId} ref (a bare email string still works — the
 * original API). `entries` is the whole ledger; `excludeId` omits an entry
 * from its own history when re-evaluating a case that is already logged.
 */
export function verdictFor(violation, agentRef, date, entries, dcm, excludeId) {
  if (!violation) return null;
  const agent = toAgentRef(agentRef);
  const d = date || todayStr();

  // Emergency leave past the quota is not leave at all — the policy reclassifies
  // it as unauthorised absence, which means it runs through the matrix.
  if (violation === "Emergency Leave") {
    const em = emergencyUsage(entries, agent, d, excludeId);
    if (em.exceeded) {
      const rule = findRule(dcm, { id: "absent", name: "Unauthorised absence" });
      if (rule) {
        const v = disciplinaryVerdict(rule, agent, d, entries, dcm, excludeId);
        return { ...v, emergency: em, reclassifiedFrom: "Emergency Leave", notes: [em.reason, ...v.notes] };
      }
    }
    return {
      disciplinary: false,
      occ: null,
      action: "No disciplinary action — approved leave",
      executor: "TL",
      severity: null,
      cap: NO_CAP,
      emergency: em,
      investigation: false,
      notes: [
        `Emergency quota: day ${em.yearAfter} of ${EMERGENCY_QUOTA} this year, ${em.remaining} remaining.`,
        `Consecutive run this month: ${days(em.run)} of ${EMERGENCY_MAX_CONSECUTIVE} allowed.`,
      ],
    };
  }

  const rule = dcm.find((r) => r.name === violation);
  if (rule) return disciplinaryVerdict(rule, agent, d, entries, dcm, excludeId);

  // Everything else is approved / excused leave.
  const notes = [];
  if (violation === "Sick Leave") notes.push("Medical certificate required for 2+ consecutive days.");
  if (violation === "Annual Leave") notes.push("Must be requested and approved one month in advance.");
  if (violation === "Work From Home") notes.push("Requires prior manager approval.");
  if (violation === "Exam Leave") notes.push("Requires proof of enrolment and the exam timetable.");
  if (violation === "Other") notes.push("Describe the case and the action taken in the notes.");

  return {
    disciplinary: false,
    occ: null,
    action: "No disciplinary action — approved leave",
    executor: "TL",
    severity: null,
    cap: NO_CAP,
    investigation: false,
    notes,
  };
}

/**
 * Rule on one or more cases: escalate ("active") or dismiss ("dismissed").
 *
 * The verdict stored at logging time is provisional — pending cases don't
 * count toward occurrence chains, so it can go stale the moment history
 * changes. Escalation is where the punitive outcome is finalized, so each
 * escalated case is re-verdicted against the ledger *as it stands then*,
 * processed oldest-first: bulk-escalating two NCNS from one RTA file
 * correctly yields a 1st then a 2nd occurrence, not two 1sts.
 *
 * Pure: returns a new entries array. Callers re-settle deductions after.
 */
export function decideCases(entries, ids, stage, { by, assignee, comment }, dcm) {
  const set = new Set(ids);
  const targets = entries
    .filter((e) => set.has(e.id))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.createdAt || 0) - (b.createdAt || 0));

  let ledger = entries;
  for (const t of targets) {
    const next = {
      ...t,
      stage,
      assignee: stage === "active" ? assignee : t.assignee,
      activity: [
        ...(t.activity || []),
        { at: Date.now(), by, type: stage === "active" ? "escalated" : "dismissed", text: comment },
      ],
    };
    if (stage === "active") {
      const v = verdictFor(t.violation, { email: t.email, empId: t.empId }, t.date, ledger, dcm, t.id);
      if (v) {
        next.occurrence = v.occ;
        next.action = v.action;
        next.executor = v.executor;
        next.severity = v.severity;
        next.disciplinary = v.disciplinary;
        next.deductionDays = v.cap.prescribed;
        next.deductionApplied = v.cap.applied;
        next.reclassifiedFrom = v.reclassifiedFrom || "";
        next.hrNeeded = v.executor === "HR";
      }
    }
    ledger = ledger.map((x) => (x.id === t.id ? next : x));
  }
  return ledger;
}

/* ── Systemic escalation thresholds ─────────────────────────────────────────
   These look across violations rather than at one rule, and fire on patterns
   the matrix alone would miss. */

export function computeEscalations(entries) {
  const live = entries.filter(countsForDiscipline);
  const today = todayStr();
  const byAgent = {};

  for (const e of live) {
    const key = agentKeyOf(e);
    if (!key) continue;
    if (!byAgent[key]) {
      byAgent[key] = { email: agentLabel(e), account: e.account, in30: 0, in60: 0, ncns: [], emergency: 0 };
    }
    const a = byAgent[key];
    a.account = e.account;
    const age = daysBetween(e.date, today);

    if (e.disciplinary) {
      if (age <= 30) a.in30++;
      if (age <= 60) a.in60++;
      if (e.violation === "NCNS" && age <= RESET_DAYS) a.ncns.push(e.date);
    }
    if (e.violation === "Emergency Leave" && yearOf(e.date) === yearOf(today)) a.emergency++;
  }

  const out = [];
  for (const a of Object.values(byAgent)) {
    if (a.ncns.length >= 2) {
      out.push({
        level: "Serious",
        kind: "ncns",
        email: a.email,
        account: a.account,
        title: `Repeat NCNS — ${a.ncns.length}× in ${RESET_DAYS} days`,
        text: "Lock operational profiles immediately and escalate to HR.",
      });
    }
    if (a.in60 >= 5) {
      out.push({
        level: "Serious",
        kind: "5in60",
        email: a.email,
        account: a.account,
        title: `${a.in60} infractions in 60 days`,
        text: "Threshold breached — open an HR intervention plan.",
      });
    } else if (a.in30 >= 3) {
      out.push({
        level: "Moderate",
        kind: "3in30",
        email: a.email,
        account: a.account,
        title: `${a.in30} infractions in 30 days`,
        text: "Mandatory one-on-one performance alignment call with the TL.",
      });
    }
    if (a.emergency > EMERGENCY_QUOTA) {
      out.push({
        level: "Serious",
        kind: "emergency",
        email: a.email,
        account: a.account,
        title: `Emergency quota exceeded — ${a.emergency}/${EMERGENCY_QUOTA}`,
        text: "Further unplanned leave is logged as unauthorised absence.",
      });
    } else if (a.emergency >= EMERGENCY_QUOTA - 1) {
      out.push({
        level: "Moderate",
        kind: "emergency",
        email: a.email,
        account: a.account,
        title: `Emergency quota nearly spent — ${a.emergency}/${EMERGENCY_QUOTA}`,
        text: "Warn the TL before approving further unplanned time off.",
      });
    }
  }

  const rank = { Serious: 0, Moderate: 1 };
  return out.sort((x, y) => rank[x.level] - rank[y.level]);
}

/**
 * Deduction days consumed by an agent in a calendar month, against the 5-day
 * ceiling.
 *
 * Counts triage-stage cases as well as escalated ones, deliberately: this is
 * the figure the cap calculator spends, and a pending case must reserve its
 * headroom or two cases could each be promised the same 5 days and blow the
 * ceiling once both are escalated. Dismissing a case hands the headroom back.
 * Kept in step with `monthDeductionUsed` in deductions.js — change both or
 * neither.
 */
export function monthlyDeductionFor(entries, agent, month) {
  return entries
    .filter((e) => agentMatches(e, agent) && e.stage !== "dismissed" && !e.voided && monthOf(e.date) === month)
    .reduce((s, e) => s + (e.deductionApplied || 0), 0);
}

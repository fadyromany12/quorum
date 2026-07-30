/* Employment lifecycle — pure functions, no I/O.

   Ported from the KOMPASS Apps Script prototype, with its two silent failures
   fixed rather than carried over:

     1. Accrual there computed service years as `today.getTime() - hiringDate.getTime()`
        where hiringDate was a *string*. That throws for every employee, and the
        throw was swallowed by a try/catch — so nobody ever accrued a day of
        annual leave. Here dates are calendar days handled by src/lib/dates.js,
        and entitlement is a pure function of two days with no Date coupling.

     2. Column indexes were resolved as `colIdx["AnnualBalance"] || 7`, which
        silently reads the wrong column whenever the header sits at index 0.
        Nothing in this module addresses columns by position at all.

   Everything here is deterministic and takes `asOf` explicitly, so tests never
   depend on the clock. */

import { daysBetween, parseDay, addDays, toDay } from "./dates.js";

/* ── Lifecycle ─────────────────────────────────────────────────────────────
   One stage at a time. The transition table is the whole state machine: if an
   edge isn't listed here it cannot happen, which is what stops the "Exited
   employee silently reactivated" class of bug. */

export const STAGES = [
  "Applicant",
  "Onboarding",
  "Probation",
  "Active",
  "OnPip",
  "Suspended",
  "Notice",
  "Exited",
];

const TRANSITIONS = {
  // An applicant is either approved into onboarding or rejected outright.
  Applicant: ["Onboarding", "Exited"],
  // Approved but not yet started. Can still fall through before day one.
  Onboarding: ["Probation", "Active", "Exited"],
  // Probation ends by confirmation, or doesn't.
  Probation: ["Active", "Notice", "Exited"],
  // The working steady state, and the only place performance action starts.
  Active: ["OnPip", "Suspended", "Notice", "Probation", "Exited"],
  // A PIP resolves up to Active or down to Notice.
  OnPip: ["Active", "Notice", "Suspended", "Exited"],
  Suspended: ["Active", "OnPip", "Notice", "Exited"],
  // Serving notice. Reversible only by explicit withdrawal.
  Notice: ["Active", "Exited"],
  // Terminal. Rehires get a new record — reusing one would corrupt service
  // years, leave accrual and disciplinary chains all at once.
  Exited: [],
};

export const isStage = (s) => STAGES.includes(s);

/** Stages that count toward headcount and payroll. */
export const COUNTS_AS_HEADCOUNT = ["Probation", "Active", "OnPip", "Suspended", "Notice"];
export const isHeadcount = (stage) => COUNTS_AS_HEADCOUNT.includes(stage);

/** Stages where the person may hold a live login and appear in operations. */
export const isWorking = (stage) => ["Probation", "Active", "OnPip", "Notice"].includes(stage);

export function canTransition(from, to) {
  if (!isStage(from) || !isStage(to)) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

/** Allowed next stages, for driving a UI without duplicating the table. */
export const nextStages = (from) => (isStage(from) ? [...TRANSITIONS[from]] : []);

/**
 * Validate a stage change, returning a reason rather than throwing so callers
 * can surface it verbatim.
 * @param {{stage: string, exitDate?: string}} employee
 * @param {string} to
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkTransition(employee, to) {
  const from = employee?.stage;
  if (!isStage(from)) return { ok: false, reason: `Unknown current stage "${from}".` };
  if (!isStage(to)) return { ok: false, reason: `Unknown target stage "${to}".` };
  if (from === to) return { ok: false, reason: `Already ${from}.` };
  if (from === "Exited") {
    return { ok: false, reason: "Exited is terminal — a returning employee needs a new record." };
  }
  if (!canTransition(from, to)) return { ok: false, reason: `Cannot go from ${from} to ${to}.` };
  return { ok: true };
}

/* ── Service ───────────────────────────────────────────────────────────────

   Whole years are counted by anniversary, not by dividing elapsed days.
   Dividing is subtly wrong: a common year is 365 days, so `365 / 365.25` is
   0.999… and an employee hired on 2025-01-01 would not have "one year of
   service" on 2025-01-01's anniversary. Both HR practice and Art. 47 mean the
   anniversary has passed. Fractional years remain available for display. */

const DAYS_PER_YEAR = 365.25;

/** Whole days of service. NaN when hireDate is missing or malformed. */
export function serviceDays(hireDate, asOf) {
  return daysBetween(hireDate, asOf);
}

/**
 * Completed whole years between two calendar days, by anniversary.
 * A Feb-29 anniversary lands on Mar 1 in common years, which is the
 * conventional reading — the year completes once March starts.
 */
function fullYearsBetween(fromDay, toDay) {
  const f = parseDay(fromDay);
  const t = parseDay(toDay);
  if (Number.isNaN(f) || Number.isNaN(t) || t < f) return 0;
  const from = new Date(f);
  const to = new Date(t);
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  // Date.UTC rolls Feb 29 into Mar 1 for common years, which is what we want.
  const anniversary = Date.UTC(to.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  if (t < anniversary) years -= 1;
  return Math.max(0, years);
}

/**
 * Fractional years of service — display only. Every threshold decision uses
 * completedYears so it agrees with the calendar.
 */
export function serviceYears(hireDate, asOf) {
  const d = serviceDays(hireDate, asOf);
  if (Number.isNaN(d) || d < 0) return 0;
  return d / DAYS_PER_YEAR;
}

/** Completed years of service, by anniversary. Drives the accrual tiers. */
export const completedYears = (hireDate, asOf) => fullYearsBetween(hireDate, asOf);

/** Age in whole years, or null when birthDate is unknown. */
export function ageAt(birthDate, asOf) {
  if (Number.isNaN(parseDay(birthDate)) || Number.isNaN(parseDay(asOf))) return null;
  if (parseDay(asOf) < parseDay(birthDate)) return null;
  return fullYearsBetween(birthDate, asOf);
}

/* ── Annual leave entitlement ──────────────────────────────────────────────
   Egyptian Labour Law No. 12/2003, Article 47:

     • 21 days once a full year of service is complete;
     • 15 days before that, from the six-month eligibility point;
     • 30 days after ten years' service — *or* on reaching age 50, which the
       KOMPASS version omitted entirely. Both are honoured here.

   Tiers are parameters, not literals: this is company policy layered on a
   statutory floor, and policy changes without the law changing. */

export const LEAVE_POLICY = {
  eligibilityDays: 180, // no annual accrual in the first six months
  baseDays: 15, // eligible, under a year
  afterOneYearDays: 21,
  longServiceYears: 10,
  longServiceDays: 30,
  longServiceAge: 50, // Art. 47's alternative route to the top tier
};

/**
 * Annual-leave days per year for one employee at a point in time.
 * @param {{hireDate: string, birthDate?: string}} employee
 * @param {string} asOf YYYY-MM-DD
 * @param {typeof LEAVE_POLICY} [policy]
 * @returns {number} days per year; 0 before the eligibility point
 */
export function annualEntitlement(employee, asOf, policy = LEAVE_POLICY) {
  const days = serviceDays(employee?.hireDate, asOf);
  if (Number.isNaN(days) || days < policy.eligibilityDays) return 0;

  const years = completedYears(employee.hireDate, asOf);
  const age = ageAt(employee?.birthDate, asOf);

  if (years >= policy.longServiceYears) return policy.longServiceDays;
  if (age !== null && age >= policy.longServiceAge) return policy.longServiceDays;
  if (years >= 1) return policy.afterOneYearDays;
  return policy.baseDays;
}

/**
 * One month's accrual credit. Kept separate from annualEntitlement so the
 * monthly job is a single obvious multiplication, and so the rounding decision
 * lives in exactly one place.
 *
 * Rounded to 2dp because balances are shown and deducted in fractions of a
 * day; accumulating raw floats drifts visibly within a year.
 */
export function monthlyAccrual(employee, asOf, policy = LEAVE_POLICY) {
  const perYear = annualEntitlement(employee, asOf, policy);
  return Math.round((perYear / 12) * 100) / 100;
}

/* ── Probation ─────────────────────────────────────────────────────────────
   Art. 33 caps probation at three months; default to that and let policy
   shorten it. */

export const PROBATION_MONTHS = 3;

/** The last day of probation, or "" when hireDate is unknown. */
export function probationEnd(hireDate, months = PROBATION_MONTHS) {
  const t = parseDay(hireDate);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const targetMonth = d.getUTCMonth() + months;
  const end = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, d.getUTCDate()));
  // Guard month-length overflow: 30 Nov + 3 months must not become 2 March.
  if (end.getUTCDate() !== d.getUTCDate()) end.setUTCDate(0);
  return addDays(toDay(end.getTime()), -1);
}

/** True when probation has elapsed and confirmation is overdue. */
export function probationDue(employee, asOf) {
  if (employee?.stage !== "Probation") return false;
  const end = employee.probationEnd || probationEnd(employee.hireDate);
  if (!end) return false;
  return daysBetween(end, asOf) >= 0;
}

/* ── Identity ──────────────────────────────────────────────────────────────*/

export const EMP_ID_PREFIX = "KOM";
const EMP_ID_RE = /^KOM-(\d+)$/;

/**
 * Next sequential employee id. KOMPASS scanned for the max and started at 1000;
 * the sequence is kept for continuity, but placeholders are ignored properly
 * (its `!val.includes("PENDING")` check let "KOM-12-PENDING" parse as 12) and
 * only exact KOM-<digits> counts.
 * @param {string[]} existing
 */
export function nextEmpId(existing = []) {
  let max = 1000;
  for (const raw of existing) {
    const m = EMP_ID_RE.exec(String(raw ?? "").trim());
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${EMP_ID_PREFIX}-${max + 1}`;
}

export const isEmpId = (v) => EMP_ID_RE.test(String(v ?? "").trim());

/** Preferred name when set, else the English full name, else the work email. */
export function displayName(e) {
  return (e?.preferredName || e?.fullNameEn || e?.workEmail || "").trim();
}

/* ── Reporting lines ───────────────────────────────────────────────────────*/

/**
 * Who must approve this employee's leave, in order.
 *
 * Ported from KOMPASS: the Functional (client-account) manager approves first
 * when they differ from the Direct manager, then the Direct manager. Its hard
 * gate is kept too — no Direct manager means no submission, which is what
 * stopped requests silently routing to "NA".
 *
 * @param {{directManagerId?: string|null, functionalManagerId?: string|null}} e
 * @returns {{ok: true, chain: string[]} | {ok: false, reason: string}}
 */
export function approvalChain(e) {
  const direct = e?.directManagerId || "";
  const functional = e?.functionalManagerId || "";
  if (!direct) {
    return { ok: false, reason: "No direct manager assigned — assign one before requesting leave." };
  }
  const chain = functional && functional !== direct ? [functional, direct] : [direct];
  return { ok: true, chain };
}

/**
 * Walk up the reporting line. Returns ids from the immediate manager upward.
 * Cycle-safe: a loop in the org chart terminates instead of hanging, which the
 * KOMPASS recursive hierarchy walk did not guard against.
 * @param {string} employeeId
 * @param {Map<string, {directManagerId?: string|null}>} byId
 */
export function managerChain(employeeId, byId) {
  const out = [];
  const seen = new Set([employeeId]);
  let cur = byId.get(employeeId)?.directManagerId || null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = byId.get(cur)?.directManagerId || null;
  }
  return out;
}

/**
 * Every employee at or below `rootId` in the direct-reporting tree, excluding
 * the root. Breadth-first and cycle-safe.
 * @param {string} rootId
 * @param {Array<{id: string, directManagerId?: string|null}>} all
 */
export function subordinateIds(rootId, all) {
  const children = new Map();
  for (const e of all) {
    const p = e.directManagerId || "";
    if (!p) continue;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(e.id);
  }
  const out = [];
  const seen = new Set([rootId]);
  const queue = [...(children.get(rootId) || [])];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of children.get(id) || []) if (!seen.has(c)) queue.push(c);
  }
  return out;
}

/**
 * Can `viewer` see `target`'s record? Managers see their own subtree; HR and
 * SuperAdmin see everyone. Deliberately a pure function of ids and role so it
 * can be unit-tested and reused by every route instead of being re-derived —
 * the inconsistency that left KOMPASS's registration approval unguarded.
 */
export function canViewEmployee(viewerRole, viewerEmployeeId, targetId, all) {
  if (["SuperAdmin", "HRBusinessPartner"].includes(viewerRole)) return true;
  if (!viewerEmployeeId) return false;
  if (viewerEmployeeId === targetId) return true;
  return subordinateIds(viewerEmployeeId, all).includes(targetId);
}

/* ── Timeline ──────────────────────────────────────────────────────────────*/

/** Event types that belong on an employee's permanent record. */
export const EVENT_TYPES = [
  "HIRED",
  "STAGE_CHANGED",
  "PROMOTED",
  "PAY_CHANGED",
  "TRANSFERRED",
  "MANAGER_CHANGED",
  "LEAVE_APPROVED",
  "VIOLATION_LOGGED",
  "COACHING_LOGGED",
  "PIP_OPENED",
  "PIP_CLOSED",
  "ASSET_ISSUED",
  "ASSET_RETURNED",
  "EXITED",
  "NOTE",
];

/**
 * Build the event describing a stage change. Callers persist the result; this
 * stays pure so the wording is testable and consistent everywhere.
 */
export function stageChangeEvent(employee, to, actor, { effectiveDate = "", detail = "" } = {}) {
  const type = to === "Exited" ? "EXITED" : to === "OnPip" ? "PIP_OPENED" : "STAGE_CHANGED";
  return {
    type,
    title: to === "Exited" ? "Left the company" : `Moved to ${to}`,
    detail,
    fromVal: employee.stage,
    toVal: to,
    effectiveDate,
    actorName: actor?.name || "",
    actorRole: actor?.role || "",
  };
}

/** Newest first, with a stable tiebreak so equal timestamps don't reorder. */
export function sortTimeline(events) {
  return [...events].sort((a, b) => {
    const d = new Date(b.at).getTime() - new Date(a.at).getTime();
    return d !== 0 ? d : String(b.id ?? "").localeCompare(String(a.id ?? ""));
  });
}

/* Workforce analytics — headcount movement, leave liability, attrition risk.

   Pure, and deliberately conservative. These are the numbers people take into
   budget meetings and headcount decisions, which means the cost of a confident
   wrong answer is much higher than the cost of an honest "not enough data".
   Three principles run through the file:

   ── A movement figure must reconcile ───────────────────────────────────────
   A headcount waterfall that does not add up — opening + joiners − leavers ≠
   closing — is worse than no waterfall, because the discrepancy is invisible
   and the number still gets quoted. `waterfall()` computes the closing balance
   and states whether it reconciles against the observed one.

   Reconciliation alone is not enough, which is worth saying because it looks
   like it should be: someone hired in March and exited in January contributes
   +1 joiner and −1 leaver, so the identity holds perfectly while the record is
   nonsense. Impossible rows are counted separately, and `trustworthy` requires
   both — a caller can then refuse to render a chart that lies in either way.

   ── A liability is money, so it is integer minor units ─────────────────────
   Accrued untaken leave is a real balance-sheet item under Egyptian law: an
   employee leaving is paid for it. It is computed in piastres through the same
   money helpers as payroll, because a leave liability quoted to the nearest
   pound and a payroll figure quoted to the piastre cannot be reconciled by
   anyone.

   ── Risk is signals, never a score ─────────────────────────────────────────
   `flightRisk` returns the signals it found and lets a human weigh them. A
   single number invites exactly the two failures that make attrition models
   notorious: it gets treated as a prediction about a person, and it hides
   which signal drove it. Naming the signals means a manager can disagree with
   one — which is the whole point, because they usually know something the
   data does not. Nothing here is a reason to act against someone; it is a
   reason to have a conversation. */

import { toMinor, fromMinor, formatMinor, dailyRate } from "./comp.js";
import { monthOf, daysBetween, todayStr } from "./dates.js";

/* ── Headcount movement ────────────────────────────────────────────────────── */

/** Stages that count as employed for headcount purposes. Applicants have not
    started; exited have gone. Notice is still headcount — they are still paid,
    still rostered, and still on the floor. */
export const EMPLOYED_STAGES = ["Onboarding", "Probation", "Active", "OnPip", "Suspended", "Notice"];

/**
 * Headcount movement over a window, and whether it reconciles.
 *
 * @param {Array<{stage: string, hireDate?: string, exitDate?: string, exitType?: string}>} employees
 * @param {string} from YYYY-MM-DD inclusive
 * @param {string} to YYYY-MM-DD inclusive
 */
export function waterfall(employees, from, to) {
  const list = employees ?? [];
  const started = (e) => e.hireDate && e.hireDate <= to;
  const goneBy = (d) => (e) => e.exitDate && e.exitDate <= d;

  /* Opening is who had started and had not yet left the day before the window.
     Derived from dates rather than from the current stage, because a stage is a
     fact about today and this is a question about a past date. */
  const opening = list.filter((e) => e.hireDate && e.hireDate < from && !(e.exitDate && e.exitDate < from)).length;
  const joiners = list.filter((e) => e.hireDate && e.hireDate >= from && e.hireDate <= to).length;
  const leavers = list.filter((e) => e.exitDate && e.exitDate >= from && e.exitDate <= to).length;
  const closingComputed = opening + joiners - leavers;
  const closingObserved = list.filter((e) => started(e) && !goneBy(to)(e)).length;

  /* Impossible records, reported separately from reconciliation.
     They are not the same check and conflating them was a mistake worth not
     making: someone hired in March and exited in January contributes +1 joiner
     and −1 leaver, so the arithmetic identity still holds perfectly while the
     record is nonsense. Reconciliation is about the sum; this is about the
     rows, and a chart wants to know about both for different reasons. */
  const impossible = list
    .filter((e) => (e.exitDate && e.hireDate && e.exitDate < e.hireDate) || (e.hireDate && e.hireDate > to && e.exitDate))
    .map((e) => ({ hireDate: e.hireDate, exitDate: e.exitDate }));

  return {
    from,
    to,
    opening,
    joiners,
    leavers,
    closing: closingObserved,
    closingComputed,
    /* Stated rather than assumed. A mismatch means the population changed
       between the two passes, or a date is malformed enough to be counted by
       one filter and not the other. */
    reconciles: closingComputed === closingObserved,
    net: joiners - leavers,
    impossible,
    /* Both must hold before a figure is worth quoting. */
    trustworthy: closingComputed === closingObserved && impossible.length === 0,
  };
}

/**
 * Attrition rate over a window, against average headcount.
 *
 * Average rather than opening or closing: a team that doubles mid-window has an
 * attrition rate that looks half what it was if measured against closing, and
 * double if measured against opening. Returns null rather than 0 when there is
 * nobody to divide by — a rate on an empty population is not zero, it is
 * undefined, and printing 0% would read as "nobody left".
 */
export function attritionRate(w) {
  const average = (w.opening + w.closing) / 2;
  if (average <= 0) return null;
  return Math.round((w.leavers / average) * 1000) / 10;
}

/** Leavers split by whether they chose to go. The two are different problems:
    one is a retention question, the other a hiring or performance one. */
export function attritionSplit(employees, from, to, classify) {
  const leavers = (employees ?? []).filter((e) => e.exitDate && e.exitDate >= from && e.exitDate <= to);
  const out = { voluntary: 0, involuntary: 0, unclassified: 0, total: leavers.length };
  for (const e of leavers) {
    const kind = classify ? classify(e.exitReason ?? e.exitType) : "unclassified";
    if (kind === "voluntary") out.voluntary++;
    else if (kind === "involuntary") out.involuntary++;
    else out.unclassified++;
  }
  return out;
}

/* ── Leave liability ───────────────────────────────────────────────────────── */

/**
 * What accrued untaken leave would cost if everyone were paid out today.
 *
 * A real balance-sheet item: under Egyptian law an employee leaving is paid for
 * their untaken balance. Computed per person at their own daily rate, because a
 * company average is wrong for everyone and wrong in a direction that depends
 * on who happens to be senior.
 *
 * People with no salary on record are excluded from the money and counted
 * separately. Assuming a figure for them would produce a liability that looks
 * complete and is not — and the count is the more useful output anyway, because
 * it names what to go and fix.
 *
 * @param {Array<{employeeId: string, balanceDays: number, monthlySalary?: string|number|null}>} rows
 */
export function leaveLiability(rows) {
  let totalMinor = 0;
  let days = 0;
  let priced = 0;
  const unpriced = [];

  for (const r of rows ?? []) {
    const balance = Number(r.balanceDays) || 0;
    if (balance <= 0) continue;
    days += balance;
    const monthly = r.monthlySalary === null || r.monthlySalary === undefined ? null : toMinor(r.monthlySalary);
    if (monthly === null) {
      unpriced.push(r.employeeId);
      continue;
    }
    totalMinor += Math.round(dailyRate(monthly) * balance);
    priced++;
  }

  return {
    totalMinor,
    total: fromMinor(totalMinor),
    display: formatMinor(totalMinor),
    days: Math.round(days * 100) / 100,
    pricedPeople: priced,
    unpricedPeople: unpriced.length,
    unpriced,
    /* Honest about its own completeness, so a finance screen can show the
       caveat next to the number rather than under it. */
    complete: unpriced.length === 0,
  };
}

/* ── Attrition risk ────────────────────────────────────────────────────────── */

/**
 * The signals worth a conversation, each with why it fired.
 *
 * Ordered by how strongly the literature and ordinary experience associate them
 * with leaving, but deliberately not weighted into a score. A manager reading
 * "three warnings in 90 days and no leave taken in six months" can act; a
 * manager reading "risk 0.72" can only either believe it or ignore it.
 *
 * @param {object} p
 * @param {string} p.hireDate
 * @param {number} [p.activeWarnings]
 * @param {number} [p.casesLast90]
 * @param {number} [p.leaveDaysTakenLast180]
 * @param {number} [p.monthsSincePayChange]
 * @param {number} [p.managerChangesLast180]
 * @param {number} [p.absenceDaysLast90]
 * @param {string} [p.asOf]
 */
export function flightRisk(p, asOf = todayStr()) {
  const signals = [];
  const service = daysBetween(p.hireDate, asOf);

  /* The first year, and especially months three to nine, is when most BPO
     attrition happens — after the novelty and before the tenure. */
  if (Number.isFinite(service) && service >= 60 && service <= 365) {
    signals.push({ code: "FIRST_YEAR", label: "Inside their first year", detail: `${Math.round(service / 30)} months of service — the window most leavers leave in.` });
  }
  if ((p.activeWarnings ?? 0) >= 2) {
    signals.push({ code: "WARNINGS", label: "Multiple live warnings", detail: `${p.activeWarnings} warnings inside the 90-day window.` });
  }
  if ((p.casesLast90 ?? 0) >= 3) {
    signals.push({ code: "CASES", label: "Frequent conduct cases", detail: `${p.casesLast90} cases in 90 days.` });
  }
  /* Not taking leave is a stronger signal than taking it. Someone banking
     their balance is often someone planning to be paid out for it. */
  if ((p.leaveDaysTakenLast180 ?? 0) === 0 && Number.isFinite(service) && service > 180) {
    signals.push({ code: "NO_LEAVE", label: "No leave taken in six months", detail: "An untouched balance is often a balance being banked for a payout." });
  }
  if ((p.monthsSincePayChange ?? 0) >= 24) {
    signals.push({ code: "PAY_STALE", label: "No pay change in two years", detail: `${p.monthsSincePayChange} months since the last salary change.` });
  }
  if ((p.managerChangesLast180 ?? 0) >= 2) {
    signals.push({ code: "MANAGER_CHURN", label: "Repeated manager changes", detail: `${p.managerChangesLast180} manager changes in six months.` });
  }
  if ((p.absenceDaysLast90 ?? 0) >= 5) {
    signals.push({ code: "ABSENCE", label: "Rising absence", detail: `${p.absenceDaysLast90} days absent in 90 days.` });
  }

  return {
    signals,
    count: signals.length,
    /* A band, not a score, and named so nobody mistakes it for a probability.
       "Worth a conversation" is an instruction; 0.72 is not. */
    band: signals.length === 0 ? "none" : signals.length <= 1 ? "watch" : signals.length <= 3 ? "conversation" : "urgent",
    summary:
      signals.length === 0
        ? "No signals."
        : `${signals.length} signal${signals.length === 1 ? "" : "s"}: ${signals.map((s) => s.label.toLowerCase()).join(", ")}.`,
  };
}

/* ── Trends ────────────────────────────────────────────────────────────────── */

/**
 * Monthly buckets over a window, so a chart has a row per month including the
 * empty ones.
 *
 * Empty months matter: a gap rendered as "no bar" and a gap rendered as
 * "missing month" look identical on a chart and mean opposite things. Every
 * month in the range is present, with zero where nothing happened.
 */
export function byMonth(rows, from, to, dateOf = (r) => r.date) {
  const months = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  const counts = new Map(months.map((m) => [m, 0]));
  for (const r of rows ?? []) {
    const key = monthOf(dateOf(r) ?? "");
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  return months.map((month) => ({ month, count: counts.get(month) }));
}

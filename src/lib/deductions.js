/* Salary-deduction caps under Egyptian Labour Law No. 12 of 2003 (am. No. 14 of 2025).

   Two independent ceilings apply, and the tighter one wins:
     · no single incident may deduct more than 5 days;
     · no calendar month may deduct more than 5 days in total, across every
       incident for that agent.

   So the matrix prescribes a deduction, and the law decides how much of it is
   actually collectable. Both numbers are kept: `prescribed` is what the DCM
   says and stays on the warning letter, `applied` is what payroll may deduct.
   The difference is not carried into the next month — it is written off. */

import { PER_INCIDENT_CAP, PER_MONTH_CAP } from "./constants.js";
import { monthOf } from "./dates.js";
import { agentMatches, toAgentRef } from "./identity.js";

/** Days of deduction named by a DCM action string, e.g. "…+ 3-day deduction" -> 3. */
export function deductionDaysOf(action) {
  if (!action) return 0;
  const m = /(\d+)\s*-?\s*day deduction/i.exec(action);
  return m ? Number(m[1]) : 0;
}

/** Deduction days already committed for this agent in the calendar month of `date`.
    Dismissed cases never count — they were thrown out at triage. */
export function monthDeductionUsed(entries, agent, date, excludeId) {
  const month = monthOf(date);
  return entries
    .filter(
      (e) =>
        e.id !== excludeId &&
        agentMatches(e, agent) &&
        e.stage !== "dismissed" &&
        !e.voided &&
        monthOf(e.date) === month
    )
    .reduce((sum, e) => sum + (e.deductionApplied || 0), 0);
}

/**
 * Apply both statutory ceilings to one prescribed deduction.
 *
 * @returns {{
 *   prescribed: number,   // what the DCM asked for
 *   applied: number,      // what payroll may actually take
 *   monthUsed: number,    // days already deducted this month, before this incident
 *   headroom: number,     // days still available this month, before this incident
 *   incidentCapped: boolean, // prescribed exceeded the 5-day single-incident ceiling
 *   monthCapped: boolean,    // the monthly ceiling bit harder than the incident one
 *   waived: number        // prescribed days the law writes off
 * }}
 */
export function applyLaborLawCap(prescribed, { entries, agent, email, empId, date, excludeId } = {}) {
  const raw = Math.max(0, prescribed || 0);
  const perIncident = Math.min(raw, PER_INCIDENT_CAP);
  // `agent` is the {email, empId} ref; bare email/empId fields are accepted for
  // callers written against the original email-only API.
  const ref = agent ? toAgentRef(agent) : { email, empId };
  const monthUsed = entries ? monthDeductionUsed(entries, ref, date, excludeId) : 0;
  const headroom = Math.max(0, PER_MONTH_CAP - monthUsed);
  const applied = Math.min(perIncident, headroom);
  return {
    prescribed: raw,
    applied,
    monthUsed,
    headroom,
    incidentCapped: raw > PER_INCIDENT_CAP,
    monthCapped: perIncident > headroom,
    waived: raw - applied,
  };
}

/**
 * Re-settle the applied deduction on every entry in the ledger.
 *
 * A month's headroom is shared, so one case's applied figure depends on its
 * neighbours: dismiss an early case and a later one in the same month may now
 * collect more. Rather than patching pairs, the whole ledger is replayed in
 * date order after any mutation — that keeps the invariant "no agent-month
 * exceeds 5 days" true by construction, whatever the edit was.
 *
 * `deductionDays` (what the matrix prescribed when the case was logged) is
 * preserved; only `deductionApplied` is recomputed. Ordering is not disturbed.
 */
export function settleDeductions(entries) {
  const chronological = [...entries].sort(
    (a, b) => String(a.date || "").localeCompare(String(b.date || "")) || (a.createdAt || 0) - (b.createdAt || 0)
  );

  const settled = [];
  const byId = new Map();
  for (const e of chronological) {
    const prescribed = e.deductionDays ?? deductionDaysOf(e.action);
    const cap = applyLaborLawCap(prescribed, { entries: settled, agent: e, date: e.date, excludeId: e.id });
    const next = {
      ...e,
      deductionDays: prescribed,
      // A dismissed case was thrown out at triage — it collects nothing and
      // frees its headroom for the rest of the month.
      deductionApplied: e.stage === "dismissed" ? 0 : cap.applied,
    };
    byId.set(e.id, next);
    settled.push(next);
  }

  return entries.map((e) => byId.get(e.id) || e);
}

/** Human-readable reasons a deduction was reduced. Empty when nothing was capped. */
export function capNotes(cap) {
  const out = [];
  if (cap.incidentCapped) {
    out.push(
      `Single-incident cap: the matrix prescribes ${cap.prescribed} days, the law allows ${PER_INCIDENT_CAP} — reduced to ${PER_INCIDENT_CAP}.`
    );
  }
  if (cap.monthCapped) {
    out.push(
      cap.headroom === 0
        ? `Monthly cap reached: ${cap.monthUsed} of ${PER_MONTH_CAP} days already deducted this month — no further deduction is collectable.`
        : `Monthly cap: ${cap.monthUsed} of ${PER_MONTH_CAP} days already deducted this month — only ${cap.headroom} day${cap.headroom === 1 ? "" : "s"} may be taken.`
    );
  }
  return out;
}

/* Training records — pure rules, no I/O.

   The middle of the journey nobody models. An agent is hired, trained, moved
   between accounts, retrained — and none of it lands on their record, so the
   two questions operations actually asks every morning have no answer:

     · Is this person cleared to take live contacts today?
     · Whose compliance training lapses this month?

   Both are the same shape: a set of requirements, a set of completions, and a
   date. Everything below is that comparison.

   Three decisions worth stating, because each one goes against the obvious:

   1. Expiry is derived, never stored. A row saying `status: "expired"` is a lie
      the moment the clock passes midnight and nothing has run — and the sweep
      that would fix it is exactly the thing you cannot depend on. Status is a
      function of (completedOn, validMonths, today), so it is right on read
      whether or not any job ever ran.

   2. Readiness fails closed. An agent with no training record at all is NOT
      ready, rather than trivially ready for having nothing outstanding. An
      empty set satisfies "every requirement met" under normal logic, which
      would clear every new joiner on their first day — the exact people the
      check exists for.

   3. A lapsed certification blocks; a lapsed *refresher* does not. What stops
      someone taking contacts is the training the client or the law requires,
      not everything anyone ever booked. That distinction lives in the taxonomy
      (`blocksProduction`), so this file never hard-codes a course name. */

import { TRAINING_TYPES, TRAINING_CODES } from "./taxonomy.js";
import { addDays, daysBetween, todayStr } from "./dates.js";

export const TRAINING_STATES = ["planned", "inProgress", "completed", "failed", "cancelled"];

/** How long a completion stays valid, by type. Months, because that is how
    certification periods are quoted; absent means it never lapses. */
export const VALIDITY_MONTHS = {
  Compliance: 12,
  DataProtection: 12,
  HealthAndSafety: 24,
  Security: 12,
  Certification: 12,
};

/** Days before expiry that a record starts being surfaced as due. Long enough
    to schedule around, short enough that the list is not permanently full. */
export const EXPIRY_WARNING_DAYS = 45;

export const isTrainingType = (c) => Object.hasOwn(TRAINING_TYPES, c);
export const isTrainingState = (s) => TRAINING_STATES.includes(s);

/**
 * The day a completion lapses, or "" if that type never does.
 * @param {string} type
 * @param {string} completedOn YYYY-MM-DD
 */
export function expiresOn(type, completedOn) {
  const months = VALIDITY_MONTHS[type];
  if (!months || !completedOn) return "";
  const d = new Date(`${completedOn}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  /* Rolling a month forward from the 31st lands in the wrong month — JS
     overflows into the next one. Clamp back to the end of the intended month,
     the way every calendar does. */
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/**
 * What a record actually is today, as opposed to what it was recorded as.
 *
 * @param {{type: string, state: string, completedOn?: string}} record
 * @param {string} [today]
 * @returns {"planned"|"inProgress"|"completed"|"failed"|"cancelled"|"expired"|"expiringSoon"}
 */
export function statusOf(record, today = todayStr()) {
  const state = record?.state ?? "planned";
  if (state !== "completed") return isTrainingState(state) ? state : "planned";

  const on = expiresOn(record.type, record.completedOn ?? "");
  if (!on) return "completed";
  const left = daysBetween(today, on);
  if (left < 0) return "expired";
  if (left <= EXPIRY_WARNING_DAYS) return "expiringSoon";
  return "completed";
}

/** Whether a record counts as satisfying its requirement right now. */
export const isValid = (record, today = todayStr()) =>
  ["completed", "expiringSoon"].includes(statusOf(record, today));

/**
 * The courses someone must hold, given what the business requires of them.
 *
 * Mandatory types are required of everyone. Client certification is required
 * per account rather than universally, which is why the account is a parameter
 * and not an assumption.
 *
 * @param {{account?: string}} [employee]
 * @returns {string[]} type codes
 */
export function requiredFor(employee = {}) {
  return TRAINING_CODES.filter((c) => {
    const t = TRAINING_TYPES[c];
    if (!t.mandatory) return false;
    // Client certification only matters once someone is on a client account.
    if (c === "Certification" && !employee.account) return false;
    return true;
  });
}

/**
 * Can this person take live contacts?
 *
 * @param {Array<{type: string, state: string, completedOn?: string}>} records
 * @param {{account?: string}} [employee]
 * @param {string} [today]
 * @returns {{ready: boolean, missing: string[], lapsed: string[], reason: string}}
 */
export function readiness(records, employee = {}, today = todayStr()) {
  const required = requiredFor(employee);
  const blocking = required.filter((c) => TRAINING_TYPES[c].blocksProduction);

  const held = new Map();
  for (const r of records ?? []) {
    if (!isTrainingType(r?.type)) continue;
    // Keep the best record per type: a valid one beats a lapsed one, and a
    // later completion beats an earlier one.
    const prev = held.get(r.type);
    if (!prev) { held.set(r.type, r); continue; }
    const better = isValid(r, today) && !isValid(prev, today);
    const newer = (r.completedOn ?? "") > (prev.completedOn ?? "");
    if (better || (isValid(r, today) === isValid(prev, today) && newer)) held.set(r.type, r);
  }

  const missing = blocking.filter((c) => !held.has(c));
  const lapsed = blocking.filter((c) => held.has(c) && !isValid(held.get(c), today));

  /* Fails closed: no records at all is "not ready", not "nothing outstanding".
     Normal set logic would clear every new joiner on their first day — the
     exact people this check exists for. */
  const ready = blocking.length > 0 && missing.length === 0 && lapsed.length === 0;

  const name = (c) => TRAINING_TYPES[c]?.label ?? c;
  let reason = "Cleared for live contacts.";
  if (!blocking.length) reason = "No training requirements are configured.";
  else if (missing.length) reason = `Not started: ${missing.map(name).join(", ")}.`;
  else if (lapsed.length) reason = `Lapsed: ${lapsed.map(name).join(", ")}.`;

  return { ready, missing, lapsed, reason };
}

/**
 * Records that need attention, worst first — the list the daily sweep mails on
 * and the screen shows.
 *
 * @param {Array<{type: string, state: string, completedOn?: string, employeeId?: string}>} records
 * @param {string} [today]
 */
export function attentionList(records, today = todayStr()) {
  const out = [];
  for (const r of records ?? []) {
    if (!isTrainingType(r?.type)) continue;
    const status = statusOf(r, today);
    if (!["expired", "expiringSoon"].includes(status)) continue;
    const on = expiresOn(r.type, r.completedOn ?? "");
    out.push({
      ...r,
      status,
      expiresOn: on,
      daysLeft: daysBetween(today, on),
      blocking: !!TRAINING_TYPES[r.type]?.blocksProduction,
    });
  }
  // Already-lapsed before merely-due, and within each, the most overdue first.
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * Validate a record before it is written.
 *
 * @param {{type?: string, state?: string, completedOn?: string, plannedOn?: string}} input
 * @param {string} [today]
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkRecord(input, today = todayStr()) {
  const type = String(input?.type ?? "");
  if (!isTrainingType(type)) return { ok: false, reason: `"${type}" is not a training type.` };

  const state = String(input?.state ?? "planned");
  if (!isTrainingState(state)) return { ok: false, reason: `"${state}" is not a training state.` };

  const completedOn = String(input?.completedOn ?? "");
  if (state === "completed") {
    if (!completedOn) return { ok: false, reason: "A completed course needs the date it was completed." };
    if (completedOn > today) return { ok: false, reason: "A course cannot be completed in the future." };
  }
  /* A completion date on something not marked complete is the commonest way a
     record ends up lying: the date is what expiry is computed from, so it must
     not exist unless the course actually finished. */
  if (state !== "completed" && completedOn) {
    return { ok: false, reason: "Only a completed course carries a completion date." };
  }
  return { ok: true };
}

/** A summary for a profile header. */
export function summarise(records, employee = {}, today = todayStr()) {
  const list = (records ?? []).filter((r) => isTrainingType(r?.type));
  const byStatus = {};
  for (const r of list) {
    const s = statusOf(r, today);
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  return {
    total: list.length,
    byStatus,
    readiness: readiness(list, employee, today),
    attention: attentionList(list, today),
  };
}

/** The day a course should next be booked, for the planning view. */
export const renewalDue = (record, today = todayStr()) => {
  const on = expiresOn(record?.type ?? "", record?.completedOn ?? "");
  return on ? addDays(on, -EXPIRY_WARNING_DAYS) : "";
};

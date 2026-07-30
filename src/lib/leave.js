/* The leave ledger — pure, no I/O.

   A balance is never a column; it is the sum of a ledger. Accruals credit it,
   grants debit it, adjustments correct it, and the entries are the explanation.
   "Why is my balance 12.5 days?" is answered by showing the rows — a stored
   balance can only answer "because it says so", and in a payroll dispute that
   is no answer at all.

   Signs are part of the type. An accrual is positive, a grant is negative, and
   validation enforces it — a "credit" that subtracts is the kind of entry that
   passes review and corrupts a year of balances. */

import { addDays, monthOf, parseDay, toDay } from "./dates.js";
import { monthlyAccrual, LEAVE_POLICY } from "./employee.js";

/* Every way a balance can move. `sign` is what validation enforces; `expiry`
   and `reversal` exist so nothing is ever deleted — an entry entered in error
   is countered, and both rows stay readable. */
export const LEDGER_TYPES = {
  accrual: { label: "Monthly accrual", sign: +1 },
  grant: { label: "Leave taken", sign: -1 },
  adjustment: { label: "Adjustment", sign: 0 }, // either direction, must say why
  expiry: { label: "Carry-over expired", sign: -1 },
  reversal: { label: "Reversal", sign: 0 },
};

export const isLedgerType = (t) => Object.hasOwn(LEDGER_TYPES, t);

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The balance: a straight sum, rounded once at the end.
 * Junk entries are excluded rather than crashing the whole ledger — one bad
 * row must not make an employee's balance unreadable.
 */
export function balanceOf(entries) {
  let sum = 0;
  for (const e of entries || []) {
    const d = Number(e?.days);
    if (!Number.isFinite(d) || !isLedgerType(e?.type)) continue;
    sum += d;
  }
  return round2(sum);
}

/** Balance plus the shape of how it got there, for the explanation view. */
export function summarize(entries) {
  const byType = {};
  let credited = 0;
  let debited = 0;
  for (const e of entries || []) {
    const d = Number(e?.days);
    if (!Number.isFinite(d) || !isLedgerType(e?.type)) continue;
    byType[e.type] = round2((byType[e.type] || 0) + d);
    if (d > 0) credited += d;
    else debited += -d;
  }
  return {
    balance: balanceOf(entries),
    credited: round2(credited),
    debited: round2(debited),
    byType,
  };
}

/**
 * Whether a proposed entry is well-formed, and why not.
 * @returns {{ok: true, days: number} | {ok: false, reason: string}}
 */
export function checkEntry(entry) {
  if (!isLedgerType(entry?.type)) return { ok: false, reason: `Unknown ledger type "${entry?.type}".` };
  const days = Number(entry.days);
  if (!Number.isFinite(days) || days === 0) return { ok: false, reason: "Days must be a non-zero number." };
  const sign = LEDGER_TYPES[entry.type].sign;
  if (sign > 0 && days < 0) return { ok: false, reason: `A ${entry.type} must be positive.` };
  if (sign < 0 && days > 0) return { ok: false, reason: `A ${entry.type} must be negative.` };
  // Free-direction types carry real correction power, so they must explain themselves.
  if (sign === 0 && !String(entry.note ?? "").trim()) {
    return { ok: false, reason: `A ${entry.type} needs a note saying why.` };
  }
  return { ok: true, days: round2(days) };
}

/* ── The accrual schedule ───────────────────────────────────────────────────
   What *should* have accrued, month by month — a pure function of the employee
   and the calendar. The sweeper diffs this against the entries that exist and
   writes only what is missing, which is what makes it idempotent: the schedule
   is the truth and the ledger converges on it, however often or rarely the job
   runs. */

/** Last calendar day of a YYYY-MM month. */
export function monthEnd(monthKey) {
  const [y, m] = String(monthKey).split("-").map(Number);
  if (!y || !m) return "";
  // Day 0 of the next month is the last day of this one.
  return toDay(Date.UTC(y, m, 0));
}

/** The month after a YYYY-MM key. */
export function nextMonth(monthKey) {
  const [y, m] = String(monthKey).split("-").map(Number);
  if (!y || !m) return "";
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * Every accrual the ledger should contain for this employee, oldest first.
 *
 * Credited at month end, for months from hire up to (and including) the last
 * *completed* month before `asOf` — the current month has not finished
 * happening, and crediting it early would let someone spend leave the month
 * might still take back (they could exit mid-month).
 *
 * Entitlement is evaluated at each month's own end, so the schedule crosses
 * tier boundaries correctly: the month an employee passes one year of service,
 * the rate steps from 15/12 to 21/12 without anyone touching anything.
 *
 * @param {{hireDate: string, birthDate?: string}} employee
 * @param {string} asOf YYYY-MM-DD
 * @param {typeof LEAVE_POLICY} [policy]
 * @returns {Array<{monthKey: string, days: number, effectiveDate: string}>}
 */
export function accrualSchedule(employee, asOf, policy = LEAVE_POLICY) {
  const hire = employee?.hireDate;
  if (Number.isNaN(parseDay(hire)) || Number.isNaN(parseDay(asOf))) return [];

  const lastCompleted = monthOf(addDays(`${monthOf(asOf)}-01`, -1));
  const out = [];
  for (let mk = monthOf(hire); mk <= lastCompleted; mk = nextMonth(mk)) {
    const end = monthEnd(mk);
    const days = monthlyAccrual(employee, end, policy);
    // Pre-eligibility months accrue nothing and get no row: an explicit zero
    // per month would be noise in every explanation view.
    if (days > 0) out.push({ monthKey: mk, days, effectiveDate: end });
  }
  return out;
}

/**
 * Schedule entries the ledger does not have yet — the sweeper's work list.
 *
 * Keyed strictly on monthKey. An accrual whose *amount* disagrees with the
 * schedule is reported separately rather than silently corrected: the ledger
 * is append-only, and an amount that changed under an old entry needs a human
 * and an adjustment, not a job quietly rewriting history.
 */
export function missingAccruals(entries, schedule) {
  const have = new Map(
    (entries || [])
      .filter((e) => e.type === "accrual" && e.monthKey)
      .map((e) => [e.monthKey, Number(e.days)]),
  );
  const missing = [];
  const disputed = [];
  for (const s of schedule || []) {
    if (!have.has(s.monthKey)) missing.push(s);
    else if (round2(have.get(s.monthKey)) !== round2(s.days)) {
      disputed.push({ ...s, ledgerDays: round2(have.get(s.monthKey)) });
    }
  }
  return { missing, disputed };
}

/**
 * The grant debit a settled request owes the ledger, or null when it owes
 * nothing. Pending and rejected requests never touch the ledger — days are
 * spent when granted, not when asked for.
 */
export function grantDebit(request) {
  if (!request || request.type !== "leave") return null;
  if (!["approved", "partial"].includes(request.status)) return null;
  const granted = Number(request.grantedUnits);
  if (!Number.isFinite(granted) || granted <= 0) return null;
  return {
    type: "grant",
    days: -round2(granted),
    requestId: request.id,
    note: request.payload?.leaveType ? `${request.payload.leaveType} leave` : "Leave",
    effectiveDate: request.payload?.from || "",
  };
}

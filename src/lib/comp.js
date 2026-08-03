/* Compensation arithmetic — pure, no I/O.

   ── Money is integers ───────────────────────────────────────────────────────
   Every calculation here works in **minor units** (piastres for EGP, cents for
   USD) held as safe integers. Binary floating point cannot represent 0.1, so
   `0.1 + 0.2 !== 0.3`, and errors compound across a payroll run of a thousand
   employees. Salaries are the last place to discover that.

   Values arrive from Postgres as decimal strings and leave as decimal strings.
   They are integers for the whole time they are being reasoned about, and are
   never a JavaScript float in between.

   ── Divisors are stated, never assumed ─────────────────────────────────────
   Converting a monthly salary to a daily rate needs a convention, and the
   convention is a policy decision with legal weight — Egyptian social-insurance
   practice divides by 30 regardless of the actual month length, which is neither
   obviously right nor something to leave implicit in a magic number. It is a
   named, overridable parameter. */

import { daysBetween } from "./dates.js";

/** Minor units per major unit. Two for every currency this will realistically see. */
export const MINOR_PER_MAJOR = 100;

/** Egyptian payroll convention: a month is 30 days for rate purposes. */
export const DAYS_PER_MONTH = 30;

/* Amounts are capped well below Number.MAX_SAFE_INTEGER so that summing a
   whole company's paybill in minor units cannot silently lose precision. */
const MAX_MINOR = 1e15;

/**
 * Decimal string or number → integer minor units.
 *
 * Parses the string itself rather than multiplying a float by 100, because
 * `Math.round(19.99 * 100)` is a coin flip on the last unit for some values.
 *
 * @param {string|number} v e.g. "14500.50", 14500, "14500"
 * @returns {number|null} integer minor units, or null when unparseable
 */
export function toMinor(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;

  const neg = s.startsWith("-");
  const [whole, frac = ""] = (neg ? s.slice(1) : s).split(".");
  // Truncate rather than round beyond two places: a third decimal in a salary
  // is data entry noise, and rounding it up silently pays someone more.
  const cents = (frac + "00").slice(0, 2);
  const n = Number(whole) * MINOR_PER_MAJOR + Number(cents);
  if (!Number.isSafeInteger(n) || Math.abs(n) > MAX_MINOR) return null;
  return neg ? -n : n;
}

/**
 * Integer minor units → decimal string, always two places.
 * A string, not a number, so it survives JSON and Postgres without a float in
 * the middle.
 */
export function fromMinor(minor) {
  if (!Number.isFinite(minor)) return "";
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const s = `${Math.floor(abs / MINOR_PER_MAJOR)}.${String(abs % MINOR_PER_MAJOR).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/** Grouped for display: 14500.5 → "14,500.50". Currency is the caller's to add. */
export function formatMinor(minor) {
  const s = fromMinor(minor);
  if (!s) return "";
  const neg = s.startsWith("-");
  const [whole, frac] = (neg ? s.slice(1) : s).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}.${frac}`;
}

/**
 * Percentage change between two amounts, to one decimal place.
 *
 * Returns null rather than Infinity when the base is zero: "increased by ∞%"
 * is not a number anyone can act on, and a first-ever salary has no percentage
 * change by definition.
 */
export function changePct(fromMinorAmt, toMinorAmt) {
  if (!Number.isFinite(fromMinorAmt) || !Number.isFinite(toMinorAmt)) return null;
  if (fromMinorAmt === 0) return null;
  return Math.round(((toMinorAmt - fromMinorAmt) / Math.abs(fromMinorAmt)) * 1000) / 10;
}

/**
 * Daily rate from a monthly amount, in minor units.
 * @param {number} monthlyMinor
 * @param {number} [divisor] days per month; the convention, stated explicitly
 */
export function dailyRate(monthlyMinor, divisor = DAYS_PER_MONTH) {
  if (!Number.isFinite(monthlyMinor) || !divisor) return 0;
  return Math.round(monthlyMinor / divisor);
}

/**
 * Arrears owed when a backdated correction means someone was underpaid.
 *
 * Deliberately takes the two amounts and the window rather than reaching into a
 * version series: what "should have been paid" depends on payroll calendars and
 * proration rules this module has no business knowing. It computes the
 * difference, honestly labelled.
 *
 * @param {number} paidMinor what was actually paid, monthly
 * @param {number} owedMinor what should have been paid, monthly
 * @param {string} from YYYY-MM-DD inclusive
 * @param {string} to YYYY-MM-DD inclusive
 * @param {{divisor?: number}} [opts]
 * @returns {{days: number, perDayMinor: number, totalMinor: number, underpaid: boolean}|null}
 */
export function arrears(paidMinor, owedMinor, from, to, { divisor = DAYS_PER_MONTH } = {}) {
  if (!Number.isFinite(paidMinor) || !Number.isFinite(owedMinor)) return null;
  const span = daysBetween(from, to);
  if (Number.isNaN(span) || span < 0) return null;
  const days = span + 1; // both ends inclusive
  const perDayMinor = dailyRate(owedMinor, divisor) - dailyRate(paidMinor, divisor);
  return {
    days,
    perDayMinor,
    totalMinor: perDayMinor * days,
    underpaid: perDayMinor > 0,
  };
}

/* ── Salary bands ───────────────────────────────────────────────────────────
   A band is a grade's floor and ceiling. Out-of-band pay is not forbidden —
   there are legitimate reasons, including a market premium or a grandfathered
   salary — but it must be *visible* at the point of approval rather than
   discovered a year later during a pay-equity review. */

/**
 * @param {number} minorAmt
 * @param {{minMinor: number, maxMinor: number}|null} band
 * @returns {{state: "in"|"below"|"above"|"unknown", pctOfRange: number|null}}
 */
export function bandPosition(minorAmt, band) {
  if (!band || !Number.isFinite(band.minMinor) || !Number.isFinite(band.maxMinor)) {
    return { state: "unknown", pctOfRange: null };
  }
  if (!Number.isFinite(minorAmt)) return { state: "unknown", pctOfRange: null };
  if (minorAmt < band.minMinor) return { state: "below", pctOfRange: 0 };
  if (minorAmt > band.maxMinor) return { state: "above", pctOfRange: 100 };
  const span = band.maxMinor - band.minMinor;
  // A zero-width band is a single valid point, not a division by zero.
  const pct = span === 0 ? 100 : Math.round(((minorAmt - band.minMinor) / span) * 1000) / 10;
  return { state: "in", pctOfRange: pct };
}

/* ── Validation ─────────────────────────────────────────────────────────────*/

export const PAY_REASONS = [
  "Hire", "Promotion", "Merit", "Adjustment", "Demotion", "Transfer", "Correction",
];

/**
 * Whether a proposed pay change is well-formed. Returns a reason rather than
 * throwing, so a route can pass it straight to the user.
 *
 * @param {{baseSalary?: string|number, currency?: string, reason?: string, effectiveFrom?: string}} p
 * @param {{previousMinor?: number|null}} [ctx]
 * @returns {{ok: true, minor: number} | {ok: false, reason: string}}
 */
export function checkPayChange(p, { previousMinor = null } = {}) {
  const minor = toMinor(p?.baseSalary);
  if (minor === null) return { ok: false, reason: "Enter an amount, e.g. 14500 or 14500.50." };
  if (minor <= 0) return { ok: false, reason: "A salary must be greater than zero." };
  if (!PAY_REASONS.includes(String(p?.reason ?? ""))) {
    return { ok: false, reason: `A reason is required: ${PAY_REASONS.join(", ")}.` };
  }
  if (!/^[A-Z]{3}$/.test(String(p?.currency ?? "EGP"))) {
    return { ok: false, reason: "Currency must be a three-letter code, e.g. EGP." };
  }
  /* A decrease is legal — demotion, reduced hours, correcting an overpayment —
     but it must be labelled as one. An unlabelled cut is far more likely to be
     a typo (a dropped digit) than an intended reduction. */
  if (previousMinor !== null && minor < previousMinor) {
    const labelled = ["Demotion", "Correction", "Adjustment"].includes(String(p.reason));
    if (!labelled) {
      return {
        ok: false,
        reason: "That is a decrease — record it as a Demotion, Adjustment or Correction.",
      };
    }
  }
  return { ok: true, minor };
}

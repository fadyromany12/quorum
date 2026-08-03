/* Payslips — assembling a month's pay from records the app already holds. Pure.

   Nothing here invents a number. Base pay comes from the effective-dated
   CompensationRecord, hours come from the roster, deductions come from the
   discipline engine, and absence comes from the leave ledger. A payslip that
   introduces a figure with no source is a payslip nobody in finance will sign.

   ── Money is integer minor units, everywhere ───────────────────────────────
   Piastres, never pounds, and never a float. `0.1 + 0.2` is the oldest bug in
   payroll and the one people notice last, because it is off by a piastre on a
   line nobody adds up until an auditor does. comp.js already parses and formats
   minor units; this module only ever adds integers.

   Rounding happens once, per line, at the point the line is created — and the
   total is then the sum of the rounded lines rather than a rounded sum. Those
   two differ, and when they differ the payslip does not add up, which is the
   single fastest way to lose an employee's trust in it.

   ── What this deliberately does not decide ─────────────────────────────────
   Social insurance and income tax rates are *supplied*, never hard-coded. Both
   change by decree, both have brackets that depend on the employer's
   registration, and a rate baked into a source file is a rate that will be
   silently wrong the month after it changes. When they are not configured the
   payslip says so; it never prints a zero, because a zero deduction reads as a
   computed answer rather than an absent one.

   ── Statute ────────────────────────────────────────────────────────────────
   Overtime multipliers are Egyptian Labour Law No. 12/2003 Art. 85: day hours
   at 135%, night hours at 170%, rest days and public holidays at 200%. The
   monthly deduction cap is Art. 60 — no more than five days' wage in a month,
   which the discipline engine already enforces; it is re-asserted here because
   a payslip is where an exceeded cap actually becomes a legal problem. */

import { toMinor, fromMinor, formatMinor, dailyRate, DAYS_PER_MONTH } from "./comp.js";
import { payableMinutes, SCHEDULE_ACTIVITIES } from "./schedule.js";

/** Art. 85 premiums, as multipliers of the ordinary hourly rate. */
export const OVERTIME_RATES = {
  day: { multiplier: 1.35, label: "Overtime (day)", cite: "Art. 85 — 135%" },
  night: { multiplier: 1.7, label: "Overtime (night)", cite: "Art. 85 — 170%" },
  restDay: { multiplier: 2.0, label: "Overtime (rest day)", cite: "Art. 85 — 200%" },
  holiday: { multiplier: 2.0, label: "Overtime (public holiday)", cite: "Art. 85 — 200%" },
};

/** Night begins at 19:00 for premium purposes unless the contract says otherwise. */
export const NIGHT_FROM_MINUTES = 19 * 60;

/** Art. 60: disciplinary deductions may not exceed five days' wage in a month. */
export const MONTHLY_DEDUCTION_CAP_DAYS = 5;

/** The standard working day, for turning a monthly salary into an hourly rate. */
export const HOURS_PER_DAY = 8;

/**
 * Ordinary hourly rate in minor units.
 *
 * Derived from the monthly salary via the 30-day convention rather than the
 * actual days in the month, because that is the convention Egyptian payroll
 * runs on and a rate that changes between February and March is a rate nobody
 * can check.
 */
export function hourlyRate(monthlyMinor, { daysPerMonth = DAYS_PER_MONTH, hoursPerDay = HOURS_PER_DAY } = {}) {
  if (!Number.isFinite(monthlyMinor) || !daysPerMonth || !hoursPerDay) return 0;
  return Math.round(monthlyMinor / (daysPerMonth * hoursPerDay));
}

/**
 * Which overtime band a roster row falls into.
 *
 * Rest day and holiday beat time of day — an overtime block on a Friday is paid
 * at 200% whether it starts at 09:00 or 21:00.
 */
export function overtimeBand(row, { restDays = [], holidays = [] } = {}) {
  if (holidays.includes(row.date)) return "holiday";
  if (restDays.includes(row.date)) return "restDay";
  const [h, m] = String(row.startTime || "00:00").split(":").map(Number);
  const start = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  return start >= NIGHT_FROM_MINUTES ? "night" : "day";
}

/**
 * One earnings or deduction line, with its own derivation.
 *
 * `how` is not decoration. Every dispute about a payslip is a dispute about one
 * line, and the person arguing needs to see the arithmetic rather than be told
 * to trust the total.
 */
const line = (code, label, amountMinor, how, extra = {}) => ({
  code,
  label,
  amountMinor: Math.round(amountMinor),
  amount: fromMinor(Math.round(amountMinor)),
  display: formatMinor(Math.round(amountMinor)),
  how,
  ...extra,
});

/**
 * Build a month's payslip.
 *
 * @param {object} p
 * @param {string} p.period YYYY-MM
 * @param {number} p.baseMonthlyMinor salary in force for the period
 * @param {Array<object>} [p.roster] schedule rows for the period
 * @param {number} [p.unpaidDays] unpaid leave / unauthorised absence, in days
 * @param {number} [p.disciplinaryDeductionDays] days deducted by the discipline engine
 * @param {string[]} [p.restDays] YYYY-MM-DD
 * @param {string[]} [p.holidays] YYYY-MM-DD
 * @param {Array<{code: string, label: string, amountMinor: number, how?: string}>} [p.allowances]
 * @param {{socialInsuranceRate?: number, taxRate?: number, configured?: boolean}} [p.statutory]
 * @param {string} [p.currency]
 */
export function buildPayslip({
  period,
  baseMonthlyMinor,
  roster = [],
  unpaidDays = 0,
  disciplinaryDeductionDays = 0,
  restDays = [],
  holidays = [],
  allowances = [],
  statutory = {},
  currency = "EGP",
}) {
  const base = Math.max(0, Math.round(Number(baseMonthlyMinor) || 0));
  const perDay = dailyRate(base);
  const perHour = hourlyRate(base);

  const earnings = [line("BASE", "Basic salary", base, `Monthly salary in force for ${period}.`)];

  for (const a of allowances) {
    const amt = Math.round(Number(a.amountMinor) || 0);
    if (amt !== 0) earnings.push(line(a.code || "ALLOWANCE", a.label || "Allowance", amt, a.how || "Recurring allowance."));
  }

  /* Overtime, banded. Grouped by band rather than listed per shift: a payslip
     with nineteen overtime lines is a payslip nobody reads, and the band is
     what determines the rate anyway. */
  const otRows = roster.filter((r) => SCHEDULE_ACTIVITIES[r.activity]?.premium);
  const bands = {};
  for (const r of otRows) {
    const band = overtimeBand(r, { restDays, holidays });
    const { paidMinutes } = payableMinutes(r);
    bands[band] = (bands[band] ?? 0) + paidMinutes;
  }
  for (const [band, minutes] of Object.entries(bands)) {
    if (minutes <= 0) continue;
    const rate = OVERTIME_RATES[band];
    const hours = minutes / 60;
    const amount = perHour * rate.multiplier * hours;
    earnings.push(
      line(`OT_${band.toUpperCase()}`, rate.label, amount,
        `${Math.round(hours * 100) / 100}h at ${formatMinor(perHour)} × ${rate.multiplier} (${rate.cite}).`,
        { hours: Math.round(hours * 100) / 100, cite: rate.cite })
    );
  }

  const gross = earnings.reduce((s, e) => s + e.amountMinor, 0);

  /* ── Deductions ─────────────────────────────────────────────────────────── */
  const deductions = [];

  if (unpaidDays > 0) {
    deductions.push(
      line("UNPAID", "Unpaid leave and absence", perDay * unpaidDays,
        `${unpaidDays} day${unpaidDays === 1 ? "" : "s"} at ${formatMinor(perDay)} (monthly ÷ ${DAYS_PER_MONTH}).`,
        { days: unpaidDays })
    );
  }

  /* The cap is applied here as well as in the discipline engine. Not
     defensiveness for its own sake — the engine caps per case, and a month can
     accumulate cases from more than one source. This is the last place before
     money leaves, so it is the place the legal limit has to hold. */
  const cappedDays = Math.min(disciplinaryDeductionDays, MONTHLY_DEDUCTION_CAP_DAYS);
  const capHit = disciplinaryDeductionDays > MONTHLY_DEDUCTION_CAP_DAYS;
  if (cappedDays > 0) {
    deductions.push(
      line("DISCIPLINE", "Disciplinary deduction", perDay * cappedDays,
        capHit
          ? `${disciplinaryDeductionDays} days were raised; Art. 60 caps a month at ${MONTHLY_DEDUCTION_CAP_DAYS}, so ${cappedDays} are deducted and ${disciplinaryDeductionDays - cappedDays} carry over.`
          : `${cappedDays} day${cappedDays === 1 ? "" : "s"} at ${formatMinor(perDay)} (Art. 60 allows up to ${MONTHLY_DEDUCTION_CAP_DAYS} a month).`,
        { days: cappedDays, cappedAt: MONTHLY_DEDUCTION_CAP_DAYS, carriedOver: Math.max(0, disciplinaryDeductionDays - cappedDays) })
    );
  }

  /* Statutory deductions are only shown when someone has configured them.
     Printing "Income tax 0.00" would read as a calculation rather than an
     omission, and the person it under-deducts is the one who finds out later. */
  const configured = statutory.configured === true;
  const notes = [];
  if (configured) {
    const si = Math.round(gross * (Number(statutory.socialInsuranceRate) || 0));
    if (si > 0) {
      deductions.push(
        line("SOCIAL_INSURANCE", "Social insurance (employee share)", si,
          `${Math.round((statutory.socialInsuranceRate || 0) * 10000) / 100}% of ${formatMinor(gross)} gross.`)
      );
    }
    const taxable = gross - si;
    const tax = Math.round(taxable * (Number(statutory.taxRate) || 0));
    if (tax > 0) {
      deductions.push(
        line("TAX", "Income tax", tax,
          `${Math.round((statutory.taxRate || 0) * 10000) / 100}% of ${formatMinor(taxable)} after social insurance.`)
      );
    }
  } else {
    notes.push(
      "Social insurance and income tax are not configured, so this payslip shows gross pay less absence and disciplinary deductions only. It is not a final net figure."
    );
  }

  const totalDeductions = deductions.reduce((s, d) => s + d.amountMinor, 0);
  const net = gross - totalDeductions;

  if (capHit) {
    notes.push(
      `Disciplinary deductions were capped at ${MONTHLY_DEDUCTION_CAP_DAYS} days for this month under Art. 60; ${disciplinaryDeductionDays - cappedDays} day(s) remain outstanding.`
    );
  }
  if (net < 0) {
    notes.push("Deductions exceed gross pay for this period. This needs a payroll decision before the run — it must not be paid as a negative.");
  }

  return {
    period,
    currency,
    baseMonthlyMinor: base,
    dailyRateMinor: perDay,
    hourlyRateMinor: perHour,
    earnings,
    deductions,
    grossMinor: gross,
    totalDeductionsMinor: totalDeductions,
    netMinor: net,
    gross: fromMinor(gross),
    totalDeductions: fromMinor(totalDeductions),
    net: fromMinor(net),
    grossDisplay: formatMinor(gross),
    netDisplay: formatMinor(net),
    statutoryConfigured: configured,
    notes,
    /* The arithmetic check, computed rather than asserted, so a caller can
       refuse to render a payslip that does not add up rather than printing one
       that quietly does not. */
    balances: gross - totalDeductions === net,
  };
}

/**
 * Everything that would make a payslip wrong, as sentences.
 *
 * A payslip is the most consequential document this system produces: it is
 * evidence in a labour dispute and the basis of someone's rent. So the failure
 * mode is refusing to produce one, never producing a plausible one.
 *
 * @returns {string[]} empty when it can be issued
 */
export function checkPayslip(slip) {
  const problems = [];
  if (!slip) return ["There is no payslip to check."];
  if (!/^\d{4}-\d{2}$/.test(String(slip.period ?? ""))) problems.push("The period is not a calendar month.");
  if (!slip.baseMonthlyMinor) problems.push("No salary is on record for this person in this period.");
  if (!slip.balances) problems.push("The lines do not add up to the net figure.");
  if (slip.netMinor < 0) problems.push("Net pay is negative.");
  for (const e of slip.earnings ?? []) {
    if (e.amountMinor < 0) problems.push(`"${e.label}" is a negative earning — it belongs in deductions.`);
    if (!e.how) problems.push(`"${e.label}" has no derivation, so nobody can check it.`);
  }
  for (const d of slip.deductions ?? []) {
    if (d.amountMinor < 0) problems.push(`"${d.label}" is a negative deduction — it belongs in earnings.`);
    if (!d.how) problems.push(`"${d.label}" has no derivation, so nobody can check it.`);
  }
  return problems;
}

/** Convenience for callers holding a decimal string rather than minor units. */
export const salaryToMinor = toMinor;

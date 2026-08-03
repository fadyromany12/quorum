/* Payroll rates — the numbers this system refuses to invent. Pure.

   Social insurance and income tax are set by decree and depend on the
   employer's registration. Hard-coding them would mean every payslip is
   silently wrong the month after a change, and the person it under-deducts
   finds out from the tax authority rather than from us.

   So they are configuration, and configuration that is *absent* is treated
   differently from configuration that is *zero*. A zero rate is a decision
   somebody made; an absent rate is a decision nobody has made yet, and the
   payslip has to say which it is. That distinction is the whole reason this
   file exists rather than a couple of columns with defaults. */

/** A rate above this is almost certainly a percentage entered as a whole
    number — 11 rather than 0.11 — which would deduct eleven times someone's
    salary. Caught as an error rather than clamped, because clamping would
    quietly deduct 95% instead. */
const MAX_RATE = 0.6;

export const EMPTY_PAYROLL = {
  configured: false,
  socialInsuranceRate: 0,
  taxRate: 0,
  note: "",
  updatedBy: "",
  updatedAt: "",
};

/**
 * Read whatever is stored into the shape the payslip engine expects.
 *
 * Anything unparseable reads as unconfigured rather than as zero. A corrupted
 * rate must not become a payslip that deducts nothing and looks finished.
 */
export function readPayroll(raw) {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PAYROLL };
  const si = Number(raw.socialInsuranceRate);
  const tax = Number(raw.taxRate);
  const usable =
    raw.configured === true &&
    Number.isFinite(si) && si >= 0 && si <= MAX_RATE &&
    Number.isFinite(tax) && tax >= 0 && tax <= MAX_RATE;
  if (!usable) return { ...EMPTY_PAYROLL, note: String(raw.note ?? "") };

  return {
    configured: true,
    socialInsuranceRate: si,
    taxRate: tax,
    note: String(raw.note ?? ""),
    updatedBy: String(raw.updatedBy ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
  };
}

/**
 * Validate a submitted set of rates.
 *
 * Rates arrive as percentages from a form (11, not 0.11) because that is how
 * finance says them out loud, and converting at the boundary means the stored
 * value is unambiguous.
 *
 * Returns a flat shape rather than a nested `value`: a discriminated union
 * inferred from plain JS narrows poorly at the TypeScript call site, and the
 * route ends up casting — which is exactly where a validation function stops
 * being load-bearing.
 *
 * @param {{socialInsurancePct?: unknown, taxPct?: unknown, note?: unknown}} body
 * @returns {{ok: boolean, reason: string, socialInsuranceRate: number, taxRate: number, note: string}}
 */
export function checkPayroll(body) {
  const si = Number(body?.socialInsurancePct);
  const tax = Number(body?.taxPct);
  const note = String(body?.note ?? "").slice(0, 500);
  const bad = (reason) => ({ ok: false, reason, socialInsuranceRate: 0, taxRate: 0, note });

  if (!Number.isFinite(si) || !Number.isFinite(tax)) return bad("Both rates are required, as percentages.");
  if (si < 0 || tax < 0) return bad("A rate cannot be negative.");
  if (si > MAX_RATE * 100 || tax > MAX_RATE * 100) {
    return bad(`A rate above ${MAX_RATE * 100}% is almost certainly a mistake — enter 11 for eleven per cent, not 0.11.`);
  }
  return { ok: true, reason: "", socialInsuranceRate: si / 100, taxRate: tax / 100, note };
}

/** What the settings screen shows in its fields, back in percentage terms. */
export const toPercent = (rate) => Math.round((Number(rate) || 0) * 10000) / 100;

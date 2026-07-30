/* Field editability policy — pure, no I/O.

   A record has fields with three different owners, and collapsing them into
   "editable" and "read-only" makes a portal either a data-quality disaster or a
   helpdesk queue:

     hrHeld    HR writes it; the employee sees it and disputes it via a ticket.
     self      The employee writes it; applies at once, and is recorded.
     verified  The employee proposes; HR checks it against a document, then it
               applies. Submitting does not change anything immediately.

   The tier is decided by what a field *controls*, never by how personal it
   feels:

     > Any field that drives a computed entitlement or a payment destination is
     > verified, not self.

   That test moves three fields out of the tier intuition puts them in. Date of
   birth drives the Art. 47 age-50 route to the 30-day leave tier — freely
   self-editable, it is a self-service pay rise of nine days. Social insurance
   number and passport appear on statutory filings. Bank details are the payment
   destination itself. */

export const TIERS = ["hrHeld", "self", "verified"];

/* Every field the portal shows, with its owner and where it lives. `entity`
   says which table the write lands in; the apply step needs it and the UI
   groups by it. Annotated as a record so TypeScript callers can index it with
   an arbitrary field name — which is the whole point of a policy lookup. */

/** @type {Record<string, {tier: "hrHeld"|"self"|"verified", entity: "employee"|"pii", label: string}>} */
export const FIELD_POLICY = {
  // ── HR-held: the employment facts ──
  empId: { tier: "hrHeld", entity: "employee", label: "Employee ID" },
  fullNameEn: { tier: "hrHeld", entity: "employee", label: "Full name (English)" },
  jobTitle: { tier: "hrHeld", entity: "employee", label: "Job title" },
  department: { tier: "hrHeld", entity: "employee", label: "Department" },
  account: { tier: "hrHeld", entity: "employee", label: "Account" },
  grade: { tier: "hrHeld", entity: "employee", label: "Grade" },
  hireDate: { tier: "hrHeld", entity: "employee", label: "Hire date" },
  workEmail: { tier: "hrHeld", entity: "employee", label: "Work email" },
  stage: { tier: "hrHeld", entity: "employee", label: "Status" },

  // ── Self-service, immediate ──
  preferredName: { tier: "self", entity: "employee", label: "Preferred name" },
  personalEmail: { tier: "self", entity: "employee", label: "Personal email" },
  phone: { tier: "self", entity: "employee", label: "Mobile" },
  addressAr: { tier: "self", entity: "employee", label: "Address (Arabic)" },
  linkedInUrl: { tier: "self", entity: "employee", label: "LinkedIn" },
  // Payroll and insurance are filed under the Arabic name, but it identifies
  // rather than computes: correcting a misspelling should not need a ticket.
  fullNameAr: { tier: "self", entity: "employee", label: "Full name (Arabic)" },
  emergencyName: { tier: "self", entity: "pii", label: "Emergency contact — name" },
  emergencyPhone: { tier: "self", entity: "pii", label: "Emergency contact — phone" },
  emergencyRelation: { tier: "self", entity: "pii", label: "Emergency contact — relationship" },
  maritalStatus: { tier: "self", entity: "pii", label: "Marital status" },

  // ── Verified: entitlements and payment destinations ──
  birthDate: { tier: "verified", entity: "employee", label: "Date of birth" },
  nationalId: { tier: "verified", entity: "pii", label: "National ID" },
  passportNumber: { tier: "verified", entity: "pii", label: "Passport number" },
  socialInsuranceNo: { tier: "verified", entity: "pii", label: "Social insurance number" },
  bankName: { tier: "verified", entity: "pii", label: "Bank" },
  accountNumber: { tier: "verified", entity: "pii", label: "Account number" },
  iban: { tier: "verified", entity: "pii", label: "IBAN" },
};

export const isField = (f) => Object.hasOwn(FIELD_POLICY, f);
export const tierOf = (f) => FIELD_POLICY[f]?.tier ?? null;
export const fieldsInTier = (tier) =>
  Object.keys(FIELD_POLICY).filter((f) => FIELD_POLICY[f].tier === tier);

/**
 * Partition a proposed edit by what may happen to each field.
 *
 * Unknown fields are refused rather than ignored: silently dropping them makes
 * the caller believe something was saved that was not, which is worse than an
 * error.
 *
 * @param {Record<string, unknown>} fields
 * @returns {{self: string[], verified: string[], refused: Array<{field: string, reason: string}>}}
 */
export function partitionEdit(fields) {
  const self = [];
  const verified = [];
  const refused = [];
  for (const f of Object.keys(fields || {})) {
    const p = FIELD_POLICY[f];
    if (!p) {
      refused.push({ field: f, reason: `"${f}" is not an editable field.` });
    } else if (p.tier === "hrHeld") {
      refused.push({ field: f, reason: `${p.label} is held by HR — dispute it rather than editing it.` });
    } else if (p.tier === "verified") {
      verified.push(f);
    } else {
      self.push(f);
    }
  }
  return { self, verified, refused };
}

/* ── Completeness ───────────────────────────────────────────────────────────
   An incentive, not a nag. The percentage counts the fields that matter, and
   the consequence attaches only to the ones that genuinely block downstream
   processing — an incomplete bank record cannot be paid, so saying so is
   accurate rather than coercive. Blocking on anything that does not truly
   block is how the mechanism loses its credibility. */

const COMPLETENESS_FIELDS = [
  // Blocks payroll: the transfer file needs a destination and the statutory
  // filings need the identifiers and the Arabic legal name.
  { field: "fullNameAr", blocking: true, why: "payroll files under the Arabic name" },
  { field: "nationalId", blocking: true, why: "statutory filings need it" },
  { field: "iban", blocking: true, why: "salary transfers need a destination" },
  { field: "bankName", blocking: true, why: "salary transfers need a destination" },
  { field: "socialInsuranceNo", blocking: true, why: "insurance filings need it" },
  // Matters, but nothing halts without it.
  { field: "phone", blocking: false },
  { field: "personalEmail", blocking: false },
  { field: "birthDate", blocking: false },
  { field: "addressAr", blocking: false },
  { field: "emergencyName", blocking: false },
  { field: "emergencyPhone", blocking: false },
  { field: "maritalStatus", blocking: false },
];

const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";

/**
 * How complete a record is, and exactly what is missing.
 *
 * Names the specific fields, never just the percentage — "94% complete" with
 * no list is a puzzle, and a puzzle gets ignored.
 *
 * @param {Record<string, unknown>} employee
 * @param {Record<string, unknown>|null} pii
 * @returns {{pct: number, missing: Array<{field: string, label: string, blocking: boolean, why?: string}>, blocked: boolean}}
 */
export function completeness(employee, pii) {
  const source = (f) => (FIELD_POLICY[f]?.entity === "pii" ? pii?.[f] : employee?.[f]);
  const missing = COMPLETENESS_FIELDS
    .filter((c) => !has(source(c.field)))
    .map((c) => ({
      field: c.field,
      label: FIELD_POLICY[c.field]?.label ?? c.field,
      blocking: c.blocking,
      ...(c.why ? { why: c.why } : {}),
    }));
  const done = COMPLETENESS_FIELDS.length - missing.length;
  return {
    pct: Math.round((done / COMPLETENESS_FIELDS.length) * 100),
    missing,
    blocked: missing.some((m) => m.blocking),
  };
}

/**
 * The change set a verified-tier request applies at approval, split by entity.
 * Only verified fields survive; anything else in the payload is discarded here
 * rather than trusted — the request body travelled through the browser.
 */
export function verifiedChangeSet(payloadFields) {
  const employee = {};
  const pii = {};
  for (const [f, v] of Object.entries(payloadFields || {})) {
    const p = FIELD_POLICY[f];
    if (!p || p.tier !== "verified") continue;
    (p.entity === "pii" ? pii : employee)[f] = String(v ?? "").trim();
  }
  return { employee, pii };
}

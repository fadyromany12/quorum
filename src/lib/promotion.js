/* Promotion — four changes that were always four unrelated edits.

   A promotion is a job change, an org change, an access change and a pay
   change, and until now each was its own action with nothing tying them
   together. The consequence is not theoretical: promote an agent to Team
   Leader today and they end up with a Team Leader job title, an Agent's login,
   and nobody reporting to them. The title says one thing, the permissions say
   another, and the org chart says a third.

   So this bundles them into one request with one approval and four effects
   applied together at settlement.

   ── The part that needs care ───────────────────────────────────────────────

   One of those four is a login role, which means a promotion is a privilege
   escalation with a friendly name. Three rules follow, and they are the reason
   this module is pure and tested rather than inline in a route:

     1. Only listed roles can be granted this way. SuperAdmin is deliberately
        not among them — the account that can reach everything, including the
        matrix and the reset of all data, is not something a promotion form
        should be able to hand out. That stays a deliberate admin action.

     2. A role change is never implied. The title mapping *suggests*, and the
        request carries an explicit role; a promotion that silently upgraded
        someone's access because their title contained the word "Lead" would be
        an escalation nobody typed.

     3. Nothing is applied on a rejection, and a partial approval is not a
        promotion. Unlike leave, there is no coherent "half" of this — you
        cannot give someone the title and withhold the access.

   ── On empty teams ────────────────────────────────────────────────────────

   Promoting someone into a manager role without assigning reports is allowed
   and flagged, not blocked. Teams are genuinely built after the promotion in
   real organisations, and a hard gate would push people to invent a report to
   get past the form. The flag is what stops it being invisible. */

import { PAY_REASONS } from "./comp.js";

/** Login roles a promotion may grant. Not a list of all roles — see rule 1. */
export const GRANTABLE_ROLES = ["Agent", "WFM", "ProjectManager", "OperationsLead", "HRBusinessPartner", "ITSupport"];

/** Roles whose holder is expected to have people reporting to them. */
export const MANAGER_ROLES = ["OperationsLead", "ProjectManager"];

export const isGrantable = (role) => GRANTABLE_ROLES.includes(role);
export const managesPeople = (role) => MANAGER_ROLES.includes(role);

/* A title is not an access level, but it is a strong hint, and typing the role
   separately every time is how a Team Leader ends up with an Agent's login.
   Suggestion only: `suggestRole` never decides, it proposes a default the
   person raising the promotion can override. */
const TITLE_HINTS = [
  [/team\s*lead|supervisor/i, "OperationsLead"],
  [/project\s*manager|account\s*manager/i, "ProjectManager"],
  [/workforce|wfm|planner|scheduler/i, "WFM"],
  [/hr\b|people\s*partner|human\s*resources/i, "HRBusinessPartner"],
  [/it\s*support|service\s*desk|helpdesk/i, "ITSupport"],
];

/**
 * The login role a job title suggests, or null when it suggests nothing.
 * Null is a real answer: most titles are agent-level and should not move access.
 */
export function suggestRole(jobTitle) {
  const t = String(jobTitle ?? "");
  if (!t.trim()) return null;
  for (const [pattern, role] of TITLE_HINTS) if (pattern.test(t)) return role;
  return null;
}

/**
 * Everything wrong with a proposed promotion, and everything worth warning
 * about — kept apart, because one list stops the request and the other does not.
 *
 * @param {object} p
 * @param {string} p.jobTitle
 * @param {string} [p.grade]
 * @param {string} [p.newRole]        login role to grant, or "" to leave alone
 * @param {string} [p.effectiveFrom]  yyyy-mm-dd
 * @param {number|null} [p.newSalaryMinor]
 * @param {number|null} [p.currentSalaryMinor]
 * @param {string} [p.currentRole]
 * @param {number} [p.reportCount]    how many people will report to them
 * @returns {{problems: string[], warnings: string[]}}
 */
export function checkPromotion({
  jobTitle = "",
  grade = "",
  newRole = "",
  effectiveFrom = "",
  newSalaryMinor = null,
  currentSalaryMinor = null,
  currentRole = "",
  reportCount = 0,
  reason = "Promotion",
} = {}) {
  const problems = [];
  const warnings = [];

  if (!String(jobTitle).trim()) problems.push("A promotion needs the new job title.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveFrom))) {
    problems.push("Give the date this takes effect (yyyy-mm-dd).");
  }
  if (!PAY_REASONS.includes(String(reason))) {
    problems.push(`The reason must be one of: ${PAY_REASONS.join(", ")}.`);
  }

  /* The access half. An unlisted role is refused rather than ignored —
     silently dropping it would apply the title and not the permissions, which
     is exactly the half-promotion this exists to prevent. */
  if (newRole) {
    if (!isGrantable(newRole)) {
      problems.push(`"${newRole}" cannot be granted by a promotion. That role is assigned deliberately by an administrator.`);
    } else if (newRole === currentRole) {
      warnings.push("The login role is unchanged — this is a title and pay change rather than a change of access.");
    }
  } else {
    const suggested = suggestRole(jobTitle);
    if (suggested && suggested !== currentRole) {
      /* A warning, not a problem. Plenty of title changes are genuinely
         sideways, and forcing a role change on every one of them would be a
         different bug in the same family. */
      warnings.push(`"${jobTitle}" usually means ${suggested} access, and no role change was included. They will keep their current login role.`);
    }
  }

  if (newRole && managesPeople(newRole) && reportCount === 0) {
    warnings.push("Nobody reports to them yet. That is allowed — teams are usually built afterwards — but the org chart will show an empty team until someone is moved.");
  }

  /* Money. A promotion that reduces pay is not impossible — a demotion uses
     the same machinery — but it must say so, because a decrease recorded as a
     "Promotion" is the kind of row that gets found in a tribunal. */
  if (newSalaryMinor != null && currentSalaryMinor != null) {
    if (newSalaryMinor < currentSalaryMinor && reason === "Promotion") {
      problems.push("That is a decrease. Record it as a Demotion or an Adjustment rather than a Promotion.");
    }
    if (newSalaryMinor === currentSalaryMinor) {
      warnings.push("The salary is unchanged.");
    }
  }

  return { problems, warnings };
}

/**
 * The four change sets a settled promotion applies, split by what they touch.
 *
 * Returned rather than performed, so the same function answers "what would
 * this do?" on the review screen and "what shall I write?" at settlement — and
 * so the mapping is testable without a database.
 *
 * @returns {{
 *   employee: Record<string, string>,
 *   role: string|null,
 *   compensation: {baseSalary: string, currency: string, reason: string, effectiveFrom: string, note: string}|null,
 *   events: string[]
 * }}
 */
export function promotionEffects(payload = {}) {
  /** @type {Record<string, string>} */
  const employee = {};
  for (const field of ["jobTitle", "grade", "department", "account", "lob", "directManagerId"]) {
    const v = payload[field];
    if (v !== undefined && v !== null && String(v) !== "") employee[field] = String(v);
  }

  /* Only a grantable role survives into the effects. The route validates too,
     but this is the last gate before a write and the payload travelled through
     a browser. */
  const role = payload.newRole && isGrantable(payload.newRole) ? String(payload.newRole) : null;

  const compensation =
    payload.newSalary == null || String(payload.newSalary) === ""
      ? null
      : {
          baseSalary: String(payload.newSalary),
          currency: String(payload.currency ?? "EGP"),
          reason: String(payload.reason ?? "Promotion"),
          effectiveFrom: String(payload.effectiveFrom ?? ""),
          note: String(payload.note ?? ""),
        };

  /* The timeline entries this earns. Named here so one promotion produces one
     coherent set rather than whatever the field-diffing happened to notice. */
  const events = ["PROMOTED"];
  if (role) events.push("ROLE_CHANGED");
  if (employee.account || employee.lob) events.push("TRANSFERRED");
  if (employee.directManagerId) events.push("MANAGER_CHANGED");
  if (compensation) events.push("PAY_CHANGED");

  return { employee, role, compensation, events };
}

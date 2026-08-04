/* Self sign-up — a new joiner enters their own data and waits for a manager.

   Until now every employment record was typed by somebody in HR from a form
   the joiner had already filled in on paper. That is two people doing one job,
   and the person who knows the answers — their own phone number, their mother's
   spelling of their name in Arabic — is not the one typing.

   So the joiner types it. They pick the manager they will report to, and that
   manager approves them into Onboarding.

   ── This is a public form on a public URL ─────────────────────────────────

   Which is the whole design problem. Everything below exists because a sign-up
   page is the one door in the building with no lock on it, and three things
   have to be true at once:

     1. A stranger cannot create an account. What sign-up creates is a person
        record with a disabled login attached — no session, no permissions, and
        nothing at all until a named manager says yes. Approval is the account
        creation; this is only the application.

     2. A stranger cannot even fill the form. It is shut unless SIGNUP_CODE is
        set, and the code is something HR hands to a joiner in their offer
        pack. Off by default, so a deployment nobody configured has no open
        door rather than a wide one.

     3. A stranger cannot read the org chart. "Pick your manager" needs a list
        of managers, which is an org chart on an unauthenticated endpoint. The
        code gates that too, and the list carries names and titles only — never
        an email address, which is what would make it worth scraping.

   ── Why the login is created disabled rather than not created ─────────────

   The alternative is to hold the application somewhere and create the login at
   approval — which means either mailing a password (email is off, and this app
   does not send passwords to anyone by any channel) or storing one somewhere
   that is not the password column. Both are worse. A disabled User row is a
   password the joiner chose, hashed the same way everyone else's is, that
   simply does not open anything yet.

   That puts one requirement on sign-in: an approved-pending account must be
   told it is pending. `authorize` used to return null for an inactive user,
   which renders as "invalid email or password" — the exact lie that cost this
   deployment an evening when the throttle did the same thing. */

import { passwordProblem } from "./auth.js";
import { ageAt } from "./employee.js";

/** The env var that opens sign-up. Unset means closed — see rule 2. */
export const SIGNUP_CODE_VAR = "SIGNUP_CODE";
/** Optional extra restriction: a comma-separated list of allowed email domains. */
export const SIGNUP_DOMAINS_VAR = "SIGNUP_EMAIL_DOMAINS";

/** Minimum working age. Egypt's Labour Law No. 12/2003 permits 15–17 only under
    restrictions this system does not model, so full employment starts at 18. */
export const MIN_AGE = 18;

const norm = (s) => String(s ?? "").trim();
const lower = (s) => norm(s).toLowerCase();

/** The domain half of an address, lowercased. "" when there isn't one. */
export const emailDomain = (email) => lower(email).split("@")[1] ?? "";

/**
 * Is sign-up open on this deployment, and under what restrictions?
 *
 * Pure and takes the environment, for the same reason the factory-reset gate
 * does: the cases worth testing are configurations, not code paths.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{open: boolean, code: string, domains: string[], reason: string}}
 */
export function signupGate(env = {}) {
  const code = norm(env[SIGNUP_CODE_VAR]);
  const domains = String(env[SIGNUP_DOMAINS_VAR] ?? "")
    .split(",")
    .map((d) => lower(d).replace(/^@/, ""))
    .filter(Boolean);

  if (!code) {
    return {
      open: false,
      code: "",
      domains,
      reason:
        `Sign-up is closed on this deployment. To open it, set ${SIGNUP_CODE_VAR} to a joining code ` +
        `and give that code to new starters — it is what stops the form being a public account queue.`,
    };
  }
  /* A four-character code on a public form is a formality rather than a gate,
     and a formality that looks like a gate is worse than no gate at all. */
  if (code.length < 8) {
    return {
      open: false,
      code: "",
      domains,
      reason: `${SIGNUP_CODE_VAR} is set but too short to be a gate. Use at least 8 characters.`,
    };
  }

  return {
    open: true,
    code,
    domains,
    reason: domains.length
      ? `Open to holders of the joining code with an address at ${domains.join(", ")}.`
      : "Open to anyone holding the joining code.",
  };
}

/** Constant-time-ish comparison. The code is low-entropy by nature, so this is
    about not leaking its length through an early return, not about secrecy. */
export function codeMatches(supplied, expected) {
  const a = norm(supplied);
  const b = norm(expected);
  if (!b) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Deliberately loose. Address validation that tries to be clever rejects real
   addresses, and the address here is only an identifier — nothing is sent to
   it, because nothing in this app sends email. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Egyptian mobile numbers: 01, then the network digit, then eight more. */
const EG_MOBILE = /^01[0125]\d{8}$/;

/**
 * Everything wrong with an application, and everything worth mentioning.
 *
 * Problems stop the submission; warnings do not. The split matters more here
 * than anywhere else in the app, because the person reading these messages has
 * no colleague to ask and no account to log into — if the form refuses them
 * without saying why, they are simply stuck.
 *
 * @param {object} p                      the submitted form
 * @param {object} ctx
 * @param {string[]} [ctx.takenEmails]    addresses already registered
 * @param {Array<{id: string, name: string}>} [ctx.managers] pickable managers
 * @param {string[]} [ctx.domains]        allowed email domains, empty = any
 * @param {string} [ctx.today]            yyyy-mm-dd
 * @returns {{problems: string[], warnings: string[]}}
 */
export function checkSignup(p = {}, ctx = {}) {
  const { takenEmails = [], managers = [], domains = [], today = "" } = ctx;
  const problems = [];
  const warnings = [];

  const name = norm(p.fullNameEn);
  if (!name) problems.push("Enter your full name as it appears on your national ID.");
  else if (!/\s/.test(name)) warnings.push("That looks like one name. Most records need your full name, not just your first.");

  const email = lower(p.email);
  if (!email) problems.push("Enter the email address you will sign in with.");
  else if (!LOOKS_LIKE_EMAIL.test(email)) problems.push("That does not look like an email address.");
  else if (takenEmails.map(lower).includes(email)) {
    /* Not an enumeration leak worth avoiding: sign-up must refuse a duplicate
       somehow, and "an account already exists" is what every silent alternative
       eventually tells them anyway, more confusingly. */
    problems.push("An account already exists for that address. Sign in instead, or use the password reset.");
  } else if (domains.length && !domains.includes(emailDomain(email))) {
    problems.push(`Use your ${domains.length === 1 ? `${domains[0]} ` : "company "}address. This form only accepts ${domains.join(" or ")}.`);
  }

  const pwProblem = passwordProblem(p.password);
  if (pwProblem) problems.push(pwProblem);
  else if (norm(p.password) !== norm(p.confirm)) problems.push("The two passwords do not match.");

  const phone = norm(p.phone).replace(/[\s-]/g, "");
  if (!phone) problems.push("Enter a mobile number — it is how your manager reaches you before your first day.");
  else if (!EG_MOBILE.test(phone)) warnings.push("That is not an Egyptian mobile number. Leave it if you meant an international one.");

  /* The manager is the approval route, so an unknown one is not a validation
     nicety — it is an application nobody will ever see. */
  const managerId = norm(p.managerId);
  if (!managerId) problems.push("Choose the manager you will report to. They are who approves this.");
  else if (!managers.some((m) => m.id === managerId)) problems.push("That manager is not on the list. Pick one from the menu.");

  const birthDate = norm(p.birthDate);
  if (!birthDate) problems.push("Enter your date of birth.");
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) problems.push("Give your date of birth as yyyy-mm-dd.");
  else if (today) {
    const age = ageAt(birthDate, today);
    if (age === null) problems.push("That date of birth is not a real date.");
    else if (age < MIN_AGE) problems.push(`Employment starts at ${MIN_AGE}. This record cannot be created.`);
    else if (age > 70) warnings.push("Check the year — that date makes you over 70.");
  }

  if (!norm(p.fullNameAr)) {
    /* A warning rather than a problem: payroll and social insurance file under
       the Arabic name, so HR will need it, but blocking the application on it
       turns a missing field into a person who never joined. */
    warnings.push("Your name in Arabic is missing. Payroll and social insurance are filed under it, so HR will ask for it later.");
  }

  return { problems, warnings };
}

/**
 * What a submitted application writes, split by table.
 *
 * The login is deliberately part of this and deliberately disabled — see the
 * header. `passHash` is not set here because hashing is server-only; the route
 * adds it.
 */
export function signupEffects(p = {}, { empId = "" } = {}) {
  const email = lower(p.email);
  const name = norm(p.fullNameEn);

  return {
    user: {
      name,
      email,
      role: "Agent",
      /* The line this whole module is arranged around. */
      active: false,
      /* They chose it themselves thirty seconds ago; forcing a change at first
         sign-in would be ceremony without a reason. */
      mustChange: false,
    },
    employee: {
      empId,
      fullNameEn: name,
      fullNameAr: norm(p.fullNameAr),
      preferredName: norm(p.preferredName),
      /* The address they sign in with, which is the same column every other
         record uses for the same purpose. If HR issues a company address on
         day one they change it here and the login follows. */
      workEmail: email,
      personalEmail: lower(p.personalEmail),
      phone: norm(p.phone).replace(/[\s-]/g, ""),
      birthDate: norm(p.birthDate),
      addressAr: norm(p.addressAr),
      jobTitle: norm(p.jobTitle),
      directManagerId: norm(p.managerId),
      /* Applicant, not Onboarding. Onboarding means the business has committed
         to this person, and nobody has yet. */
      stage: "Applicant",
    },
    /* No timeline event. The record's own creation is the event, and a HIRED
       entry for somebody who might be rejected tomorrow would be a lie the
       timeline never takes back. */
    events: [],
  };
}

export const SIGNUP_DECISIONS = ["approve", "reject"];

/**
 * Who may decide an application: the manager it was addressed to, HR, or the
 * Super Admin. Explicitly not "any manager" — an application routed to a named
 * person is a request of that person, and letting a peer approve it quietly
 * removes the only human check in the flow.
 */
export function canDecideSignup(viewer = {}, applicant = {}) {
  if (["SuperAdmin", "HRBusinessPartner"].includes(viewer.role)) return true;
  return Boolean(viewer.employeeId) && viewer.employeeId === norm(applicant.directManagerId);
}

/**
 * What a decision writes.
 *
 * Approval is where the account actually comes into existence, so it is the
 * only place `active` is turned on. Rejection leaves the login disabled and
 * marks the record Exited rather than deleting it — an application that was
 * refused is a fact worth keeping, and the address stays taken so a rejected
 * applicant cannot quietly re-apply into a different manager's queue.
 *
 * @returns {{
 *   user: {active: boolean},
 *   employee: {stage: string, exitType?: string, exitReason?: string, exitDate?: string},
 *   event: {type: string, summary: string}
 * }}
 */
export function decisionEffects(decision, { note = "", deciderName = "", today = "" } = {}) {
  if (!SIGNUP_DECISIONS.includes(decision)) throw new Error(`Unknown decision: ${decision}`);

  if (decision === "approve") {
    return {
      user: { active: true },
      employee: { stage: "Onboarding" },
      event: {
        type: "STAGE_CHANGED",
        summary: `Application approved by ${deciderName || "their manager"} — moved to Onboarding.${note ? ` ${note}` : ""}`,
      },
    };
  }

  return {
    user: { active: false },
    employee: {
      stage: "Exited",
      exitType: "EndOfContract",
      exitReason: note || "Application not approved.",
      exitDate: today,
    },
    event: {
      type: "EXITED",
      summary: `Application declined by ${deciderName || "their manager"}.${note ? ` ${note}` : ""}`,
    },
  };
}

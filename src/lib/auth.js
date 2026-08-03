/* Role-based access control — pure maps, safe to import from client and
   server alike. Password hashing lives in passwords.ts (server-only); the
   NextAuth wiring lives in src/auth.ts. */

export const ROLES = ["SuperAdmin", "HRBusinessPartner", "OperationsLead", "ProjectManager", "WFM", "ITSupport", "Agent"];

export const ROLE_LABEL = {
  SuperAdmin: "Super Admin",
  HRBusinessPartner: "HR Business Partner",
  OperationsLead: "Operations Lead",
  ProjectManager: "Project Manager",
  WFM: "WFM",
  ITSupport: "IT Support",
  Agent: "Agent",
};

/** Every seeded or admin-reset account starts here, and must change it on first login. */
export const DEFAULT_PASSWORD = "Welcome@123";
export const MIN_PASSWORD = 8;

/**
 * Password policy in one place — returns null when the password is acceptable,
 * else a short human-readable reason. Pure, so the change-password form and the
 * API enforce exactly the same rule (client for instant feedback, server for
 * authority).
 */
export function passwordProblem(pw) {
  const s = String(pw || "");
  if (s.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (!/[a-z]/.test(s)) return "Add a lowercase letter.";
  if (!/[A-Z]/.test(s)) return "Add an uppercase letter.";
  if (!/[0-9]/.test(s)) return "Add a number.";
  if (s === DEFAULT_PASSWORD) return "Choose a password different from the default.";
  return null;
}

/* What each staff role may see. Agents never reach the workspace at all —
   they live in /agent-portal, enforced by the route-group layouts. */
export const TABS_FOR = {
  /* Everything, including the help desk. SuperAdmin holds issueReset and
     revokeReset, and for a while held them with nowhere to use them: the
     permission passed, the API would have answered, and the screen was simply
     not in this list. The guide even told them where to go. A permission
     without a screen is not a smaller capability — it is an absent one. */
  SuperAdmin: [
    "dashboard", "joining", "floor", "exceptions", "requests", "approvals", "log", "rta", "wfm",
    "triage", "agents", "leaving", "people", "roster", "insights", "audit",
    "helpdesk", "matrix", "users", "settings",
  ],
  /* WFM owns real-time adherence and the plan behind it. The planning screen is
     their primary one now — the floor tells them what is happening, the plan
     tells them what was supposed to. */
  WFM: ["wfm", "floor", "exceptions", "rta"],
  ProjectManager: ["dashboard", "joining", "floor", "exceptions", "requests", "log", "wfm", "triage", "agents", "leaving", "people", "roster", "insights"],
  OperationsLead: ["dashboard", "joining", "floor", "exceptions", "requests", "approvals", "wfm", "agents", "leaving", "people", "roster", "insights"],
  /* HR owns both ends of the journey — admitting people and exiting them — so
     joining and leaving are theirs before anyone else's. */
  HRBusinessPartner: [
    "dashboard", "joining", "floor", "exceptions", "requests", "approvals",
    "triage", "agents", "leaving", "people", "roster", "insights", "audit",
  ],
  /* IT exists to unlock people, and that is all. No directory, no cases, no
     pay — an account-recovery desk needs to know that a login exists and that
     the person in front of them matches it, and nothing else. Giving them the
     directory "so they can find someone" would hand the widest-hours, highest-
     turnover team in the building a read of the whole employee record. */
  ITSupport: ["helpdesk"],
  Agent: [],
};

const PERMS = {
  // Any pipeline participant may write case fields; which *controls* they see
  // is still gated per-step below. WFM and Agent never edit cases directly.
  caseWrite: ["SuperAdmin", "ProjectManager", "OperationsLead", "HRBusinessPartner"],
  log: ["SuperAdmin", "ProjectManager"],
  upload: ["SuperAdmin", "WFM"],
  triage: ["SuperAdmin", "ProjectManager"], // escalate / dismiss / notify / assign
  ops: ["SuperAdmin", "OperationsLead"],
  hr: ["SuperAdmin", "HRBusinessPartner"],
  admin: ["SuperAdmin"], // DCM, users, settings, factory reset
  delete: ["SuperAdmin"], // destroying a case erases evidence — admin only
  acknowledge: ["Agent"], // digital signature on finalized cases
  audit: ["SuperAdmin", "HRBusinessPartner"], // read the immutable system log

  /* ── Employee records ───────────────────────────────────────────────────
     employeeRead is the door, not the whole house: holding it gets a role into
     the directory, but which *rows* come back is narrowed per-request by
     canViewEmployee() so a lead sees their own subtree and no further. */
  employeeRead: ["SuperAdmin", "HRBusinessPartner", "OperationsLead", "ProjectManager"],
  employeeWrite: ["SuperAdmin", "HRBusinessPartner"],
  // Advancing someone's lifecycle stage — confirm probation, open a PIP, exit.
  lifecycle: ["SuperAdmin", "HRBusinessPartner"],
  /* Government identifiers and bank details. Deliberately narrower than
     employeeRead and separate from employeeWrite: a lead legitimately needs to
     know who reports to them without ever being able to pull an IBAN. Every
     read is audited, because an unaudited PII read is indistinguishable from
     exfiltration after the fact. */
  piiRead: ["SuperAdmin", "HRBusinessPartner"],
  piiWrite: ["SuperAdmin", "HRBusinessPartner"],

  /* ── Attendance ─────────────────────────────────────────────────────────
     Punching for yourself needs no permission beyond having an employment
     record — every role including Agent does it, and gating it would only
     break the clock for whoever was left out of the list. */
  // Punching on someone else's behalf. A real operation (an agent whose
  // headset died, a system outage at login) but attributable and narrow.
  punchOthers: ["SuperAdmin", "WFM", "OperationsLead", "ProjectManager"],
  // The live floor view. WFM is the primary consumer; leads see their own scope.
  floorView: ["SuperAdmin", "WFM", "OperationsLead", "ProjectManager", "HRBusinessPartner"],

  /* ── Account recovery ───────────────────────────────────────────────────
     Issuing a reset code is not the same power as changing a password, and the
     split is the point: an IT desk can start a recovery, but only the employee
     can finish one. Nobody with this permission ever learns a password. */
  issueReset: ["SuperAdmin", "ITSupport"],
  /* Killing a live code — for when someone reports a code they did not ask
     for. Deliberately as wide as issuing it: whoever can start a recovery must
     be able to stop one, immediately, without finding an admin. */
  revokeReset: ["SuperAdmin", "ITSupport"],

  /* ── Workforce management ───────────────────────────────────────────────
     Reading the plan is deliberately wide. A lead who cannot see that 14:00 is
     three short will keep approving leave into it, and then the plan and the
     floor disagree for reasons nobody can see. Writing it is narrow, because a
     forecast two people can edit is a forecast neither of them trusts. */
  wfmRead: ["SuperAdmin", "WFM", "OperationsLead", "ProjectManager", "HRBusinessPartner"],
  wfmWrite: ["SuperAdmin", "WFM"],
  /* Rostering is wider than forecasting: WFM builds the schedule, but a lead
     legitimately moves one of their own people between shifts. Which *rows*
     they may touch is narrowed per-request by the same visibility rules the
     directory uses. */
  scheduleWrite: ["SuperAdmin", "WFM", "OperationsLead"],
};

export const can = (user, action) => !!user && (PERMS[action] || []).includes(user.role);

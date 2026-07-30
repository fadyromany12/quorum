/* Role-based access control — pure maps, safe to import from client and
   server alike. Password hashing lives in passwords.ts (server-only); the
   NextAuth wiring lives in src/auth.ts. */

export const ROLES = ["SuperAdmin", "HRBusinessPartner", "OperationsLead", "ProjectManager", "WFM", "Agent"];

export const ROLE_LABEL = {
  SuperAdmin: "Super Admin",
  HRBusinessPartner: "HR Business Partner",
  OperationsLead: "Operations Lead",
  ProjectManager: "Project Manager",
  WFM: "WFM",
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
  SuperAdmin: ["dashboard", "people", "floor", "log", "rta", "triage", "approvals", "agents", "audit", "dcm", "users", "settings"],
  // WFM owns real-time adherence, so the floor is their primary screen.
  WFM: ["floor", "rta"],
  ProjectManager: ["dashboard", "people", "floor", "log", "triage", "agents"],
  OperationsLead: ["dashboard", "people", "floor", "approvals", "agents"],
  HRBusinessPartner: ["dashboard", "people", "floor", "approvals", "agents", "audit"],
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
};

export const can = (user, action) => !!user && (PERMS[action] || []).includes(user.role);

/* What each role can actually do — pure, derived, never hand-maintained.

   A written-by-hand help page is a second source of truth about permissions,
   and the second one is always the one that goes stale. It tells a Project
   Manager they can approve leave three months after that moved to Operations,
   and the person believes it, because a help page reads as authoritative.

   So nothing here asserts a capability. Every entry names the permission or the
   screen it depends on, and `guideFor` filters against the same maps the app
   enforces with. If a role loses `triage`, the line about triage disappears
   from their guide on the next render — no edit, no drift, and no possibility
   of the guide promising something the API will refuse.

   The consequence worth accepting: this file cannot describe anything the
   permission system does not model. That is a feature. A capability nobody can
   point at a permission for is a capability nobody should be documenting. */

import { can, TABS_FOR, ROLE_LABEL, ROLES } from "./auth.js";
import { NAV_SECTIONS, NAV_ORDER, sectionOfTab } from "./journey.js";

/** One line on what the role is for, in their own terms. */
export const ROLE_PURPOSE = {
  SuperAdmin: "You can reach everything, including the settings and the discipline matrix that shape how the rest of the app behaves.",
  HRBusinessPartner: "You own both ends of the journey — admitting people and exiting them — plus the records and identifiers in between.",
  OperationsLead: "You run the floor for your teams: attendance, approvals and the conduct cases that reach you.",
  ProjectManager: "You look after your accounts — the people on them, their attendance, and the cases you raise.",
  WFM: "You own the plan and the floor it plays out on — the demand forecast, the roster that covers it, and real-time adherence against both.",
  ITSupport: "Account recovery, and only that: you can issue a one-time code that lets someone set a new password themselves. You never see or set the password, and you cannot reach anyone's record.",
  Agent: "Your own record: your clock, your leave, your requests and anything HR needs you to sign.",
};

/* Agents have no workspace tabs at all, so their lines cannot be grouped by a
   navigation section that does not exist for them. */
const PORTAL = { id: "portal", label: "Your portal" };

/* Each entry names what it needs. `perm` is checked with can(); `tab` is
   checked against the role's screens; `role` pins a line to one role. An entry
   with a `tab` inherits that tab's section; anything else declares one, and
   checkGuide() rejects a section id the navigation does not define.

   An entry may carry both, and the ones whose `where` names a real screen do.
   That pairing is the assertion: holding the permission is not the same as
   being able to reach the place the line sends you, and for a while SuperAdmin
   held issueReset while the Help desk was absent from their sidebar. Both
   fields were individually valid the whole time, which is exactly why the
   check that looked at them separately saw nothing wrong. */
const ENTRIES = [
  // ── Everyone with a workspace ──
  { tab: "dashboard", what: "See headcount, joiners, people on a plan and leavers at a glance", where: "Overview" },
  { tab: "people", what: "Search the directory and open anyone's full record", where: "Directory" },
  { tab: "roster", what: "Scan every employee as a sortable table and export what you need", where: "All employees" },

  // ── Joining ──
  { tab: "joining", what: "Chase everyone between an accepted offer and a confirmed probation", where: "New joiners" },
  { perm: "employeeWrite", tab: "people", section: "join", what: "Admit a new person and create their employment record", where: "Directory → Admit someone" },
  { perm: "lifecycle", tab: "people", section: "join", what: "Move someone through the lifecycle — confirm probation, open a plan, record an exit", where: "Any record" },

  // ── Working ──
  { tab: "floor", what: "Watch who is logged in, what state they are in, and who is over their break", where: "Live floor" },
  { tab: "requests", what: "Raise and track leave, overtime, transfers and HR letters", where: "Requests" },
  { tab: "approvals", what: "Decide what is waiting on you, including partial approvals", where: "My approvals" },
  { tab: "log", what: "Log an attendance or conduct event against someone", where: "Log an event" },
  { tab: "rta", what: "Import the adherence report and turn it into cases", where: "Import adherence" },
  { tab: "wfm", what: "See what the queue needs hour by hour, and whether the roster covers it", where: "Planning" },
  { perm: "wfmWrite", tab: "wfm", section: "work", what: "Load a demand forecast and set the service target it is planned to", where: "Planning → Forecast" },
  { perm: "scheduleWrite", tab: "wfm", section: "work", what: "Build and publish the roster — shifts, training, days off", where: "Planning → Roster" },
  { perm: "punchOthers", tab: "floor", section: "work", what: "Clock someone in or out on their behalf when their headset dies", where: "Live floor" },

  // ── Growing ──
  { tab: "triage", what: "Review new cases — escalate, dismiss or send them on", where: "Case review" },
  { tab: "agents", what: "Read an agent's scorecard: their history, warnings and hours lost", where: "Scorecards" },

  // ── Leaving ──
  { tab: "leaving", what: "Track people serving notice and tick their exit clearance", where: "Leavers" },

  // ── Records and trust ──
  { perm: "piiRead", tab: "people", section: "records", what: "Reveal identifiers and bank details — every view is recorded against your name", where: "Any record → Reveal" },
  { perm: "piiWrite", tab: "people", section: "records", what: "Correct identifiers and payroll details", where: "Any record" },
  { tab: "insights", what: "See headcount movement, attrition and who is worth a conversation", where: "Insights" },
  { perm: "piiRead", tab: "insights", section: "records", what: "See what accrued untaken leave would cost to pay out", where: "Insights" },
  { tab: "audit", what: "Read the immutable log of who did what", where: "Audit trail" },

  // ── Setup ──
  { tab: "matrix", what: "Change the discipline matrix — the rules every verdict comes from", where: "Discipline matrix" },
  { tab: "users", what: "Create logins, set roles and reset passwords", where: "Accounts" },
  { tab: "settings", what: "Manage accounts, their lines of business, and team leads", where: "Settings" },
  { perm: "issueReset", tab: "helpdesk", section: "setup", what: "Issue a one-time code so someone locked out can set a new password themselves", where: "Help desk" },
  { perm: "revokeReset", tab: "helpdesk", section: "setup", what: "Kill a live code immediately if someone reports one they did not ask for", where: "Help desk" },

  // ── Agents ──
  { role: "Agent", section: "portal", what: "Clock in and out, and change your state through the day", where: "Your portal" },
  { role: "Agent", section: "portal", what: "Request leave and see your balance with its full derivation", where: "Your portal" },
  { role: "Agent", section: "portal", what: "Ask HR for a bank, employment or salary letter and download the PDF", where: "Your portal" },
  { role: "Agent", section: "portal", what: "Read and digitally sign anything HR has finalised on your file", where: "Your portal" },
  { role: "Agent", section: "portal", what: "Update your own contact details, and propose changes HR must verify", where: "Your portal" },
];

/** Whether a role genuinely holds what this entry describes. */
function visible(entry, role) {
  if (entry.role) return entry.role === role;
  if (entry.tab && !(TABS_FOR[role] ?? []).includes(entry.tab)) return false;
  if (entry.perm && !can({ role }, entry.perm)) return false;
  return true;
}

/** Which navigation section an entry belongs under. */
const sectionIdOf = (entry) => entry.section ?? sectionOfTab(entry.tab)?.id ?? "";

/**
 * The things this role can genuinely do.
 *
 * @param {string} role
 * @returns {Array<{what: string, where: string}>}
 */
export function guideFor(role) {
  return ENTRIES.filter((e) => visible(e, role)).map(({ what, where }) => ({ what, where }));
}

/**
 * The guide grouped by the journey phase each capability sits in, so it reads
 * in the same order as the sidebar the person is looking at.
 *
 * @returns {Array<{id: string, group: string, items: Array<{what: string, where: string}>}>}
 */
export function groupedGuideFor(role) {
  const labels = new Map([...NAV_SECTIONS.map((s) => [s.id, s.label]), [PORTAL.id, PORTAL.label]]);
  const order = [...NAV_SECTIONS.map((s) => s.id), PORTAL.id];
  const buckets = new Map();
  for (const e of ENTRIES) {
    if (!visible(e, role)) continue;
    const id = sectionIdOf(e);
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push({ what: e.what, where: e.where });
  }
  return [...buckets.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([id, items]) => ({ id, group: labels.get(id) ?? "Elsewhere", items }));
}

/**
 * Everything wrong with the guide's own wiring — a typo'd permission, a screen
 * the navigation never places, a line no role can ever see, a role that would
 * open the dialog to an empty page.
 *
 * These are exactly the failures the derivation cannot report at runtime: an
 * entry keyed on a permission that does not exist silently shows to nobody, and
 * a guide that quietly omits a capability is the same problem as one that
 * invents a capability, only harder to notice.
 *
 * @returns {string[]} empty when the guide is sound
 */
export function checkGuide() {
  const problems = [];
  const tabs = new Set(NAV_ORDER);
  const sections = new Set([...NAV_SECTIONS.map((s) => s.id), PORTAL.id]);

  for (const e of ENTRIES) {
    const at = `"${e.what}"`;
    if (!e.what || !e.where) problems.push(`${at} is missing its text or its location.`);
    if (e.tab && !tabs.has(e.tab)) problems.push(`${at} points at screen "${e.tab}", which the navigation does not place.`);
    if (e.role && !ROLES.includes(e.role)) problems.push(`${at} is pinned to unknown role "${e.role}".`);
    if (e.perm && !ROLES.some((r) => can({ role: r }, e.perm))) {
      problems.push(`${at} needs permission "${e.perm}", which no role holds — likely a typo, so the line would never appear.`);
    }
    const section = sectionIdOf(e);
    if (!section) problems.push(`${at} has no section, so it would be grouped nowhere.`);
    else if (!sections.has(section)) problems.push(`${at} sits in unknown section "${section}".`);
    if (!ROLES.some((r) => visible(e, r))) problems.push(`${at} is visible to no role at all.`);

    /* The pairing. Holding a permission and being able to open the screen it is
       exercised on are different facts, and the app enforces them separately —
       so a role can hold `issueReset`, have the API answer, and have no sidebar
       entry to reach it from. visible() hides the line, which keeps the guide
       from lying; this reports why it was hidden, which is the part worth
       fixing. Checking `perm` and `tab` one at a time never sees it: both are
       individually valid the entire time the capability is unreachable. */
    if (e.perm && e.tab) {
      for (const r of ROLES) {
        if (!can({ role: r }, e.perm) || (TABS_FOR[r] ?? []).includes(e.tab)) continue;
        problems.push(
          `${r} holds "${e.perm}" but has no "${e.tab}" screen, so ${at} — which sends them to ${e.where} — is a permission they cannot use.`,
        );
      }
    }
  }

  for (const r of ROLES) {
    if (guideFor(r).length === 0) problems.push(`${r} would open the guide to an empty page.`);
    if (!ROLE_PURPOSE[r]) problems.push(`${r} has no stated purpose.`);
  }
  return problems;
}

/** Heading for the dialog. */
export const guideTitle = (role) => `What you can do as ${ROLE_LABEL[role] ?? role}`;

/** Bumped when the guide changes enough that people should see it again. A
    dismissal is remembered per version, so a genuinely new capability can
    re-open it once without nagging on every release. */
export const GUIDE_VERSION = 1;
export const guideKey = (role) => `quorum.guide.${role}.v${GUIDE_VERSION}`;

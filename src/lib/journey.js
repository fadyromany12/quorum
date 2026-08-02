/* The employee journey — the spine the whole application hangs off.

   This app began as a disciplinary tool and its navigation showed it: a flat
   list of thirteen screens with the discipline matrix sitting in the middle as
   though it were a peer of "People". That shape teaches a new user that the
   product is about violations, which is no longer true and was never the goal.

   The organising idea is simpler and matches how anyone in HR or operations
   actually talks about the work: a person joins, they work, they grow, and
   eventually they leave. Every screen belongs to exactly one of those, and the
   ones that belong to none are configuration — which is where the discipline
   matrix goes, because a matrix is a policy you set up, not a place you spend
   your day.

   Two rules kept this honest:

     1. A stage exists because a person is in it, not because a screen is. The
        stages come from the lifecycle the database already models, so the
        navigation and the employment record cannot tell different stories.

     2. Nothing is here that does not exist. There is no "Growth" section
        pointing at an empty page — training and performance are named in the
        taxonomy but have no records yet, so the section says so rather than
        pretending. An empty tab is worse than an absent one: it reads as a
        broken feature instead of an unbuilt one. */

/** The four phases of employment, in order. */
export const JOURNEY = [
  {
    id: "join",
    label: "Joining",
    labelAr: "الالتحاق",
    blurb: "Offer to first day on the floor",
    /* Applicants are here rather than hidden: someone with an accepted offer is
       a person the business has committed to, and they need chasing before they
       become an employee, not after. */
    stages: ["Applicant", "Onboarding", "Probation"],
  },
  {
    id: "work",
    label: "Working",
    labelAr: "العمل",
    blurb: "The daily shift — clock, schedule, requests",
    stages: ["Active"],
  },
  {
    id: "grow",
    label: "Growing",
    labelAr: "التطوير",
    blurb: "Coaching, conduct and performance plans",
    stages: ["OnPip", "Suspended"],
  },
  {
    id: "leave",
    label: "Leaving",
    labelAr: "إنهاء الخدمة",
    blurb: "Notice, clearance and the final record",
    stages: ["Notice", "Exited"],
  },
];

export const JOURNEY_IDS = JOURNEY.map((p) => p.id);
export const phase = (id) => JOURNEY.find((p) => p.id === id) ?? null;

/** Which phase a lifecycle stage belongs to. */
export function phaseOfStage(stage) {
  return JOURNEY.find((p) => p.stages.includes(stage))?.id ?? null;
}

/** The stages a phase covers — what its directory view filters on. */
export const stagesOf = (id) => phase(id)?.stages ?? [];

/* ── Navigation ─────────────────────────────────────────────────────────────

   Sections, not a flat list. The order is the journey's order, so the sidebar
   reads top to bottom the way employment runs, and the two sections that are
   not phases — the whole-population views and the setup screens — bracket it.

   `tabs` are ids the workspace already knows how to render; this file decides
   only where they sit and what they are called. Renaming a screen is an edit
   here, not a hunt through JSX. */

export const NAV_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    tabs: ["dashboard"],
  },
  {
    id: "join",
    label: "Joining",
    phase: true,
    tabs: ["joining"],
  },
  {
    id: "work",
    label: "Working",
    phase: true,
    tabs: ["floor", "requests", "approvals", "log", "rta"],
  },
  {
    id: "grow",
    label: "Growing",
    phase: true,
    tabs: ["triage", "agents"],
  },
  {
    id: "leave",
    label: "Leaving",
    phase: true,
    tabs: ["leaving"],
  },
  {
    id: "records",
    label: "Records",
    tabs: ["people", "roster", "audit"],
  },
  {
    id: "setup",
    label: "Set up",
    tabs: ["matrix", "users", "settings"],
  },
];

/** Every tab id the navigation places, in display order. */
export const NAV_ORDER = NAV_SECTIONS.flatMap((s) => s.tabs);

/** The section a tab belongs to — for the breadcrumb above the content. */
export function sectionOfTab(tabId) {
  return NAV_SECTIONS.find((s) => s.tabs.includes(tabId)) ?? null;
}

/**
 * Group a role's permitted tabs into sections, dropping any section left empty.
 *
 * A section header with nothing under it is the visual equivalent of a broken
 * link — WFM sees two screens, and they should see two screens under one
 * heading rather than seven headings and two entries scattered among them.
 *
 * @param {string[]} allowedTabs
 * @param {Record<string, {label: string, icon?: unknown}>} meta
 */
export function navFor(allowedTabs, meta = {}) {
  const allowed = new Set(allowedTabs);
  return NAV_SECTIONS
    .map((s) => ({
      ...s,
      items: s.tabs.filter((t) => allowed.has(t)).map((t) => ({ id: t, ...(meta[t] ?? {}) })),
    }))
    .filter((s) => s.items.length > 0);
}

/* Raising something above your manager.

   Every route through this app runs through the direct manager. Leave,
   overtime, swaps, transfers, a reporting-line change — all of it is addressed
   to the person you report to, which is right for almost everything and
   catastrophic for the one case where the person you report to is the problem.

   There was no path. Somebody being underpaid, worked past their hours, or
   treated badly by their own lead had exactly one option in this product: raise
   it with that lead.

   ── The rule everything else follows from ─────────────────────────────────

   An escalation about a manager must be invisible to that manager. Not
   "hidden from their inbox" — invisible, including from every list they can
   reach as a lead, including the overdue-requests view, including a count.
   A badge that says "1 request in your team" when the request is about them is
   a disclosure, and the person who raised it has to live with the consequences
   of it.

   That is why this routes on the *skip* level rather than the chain, and why
   the module names which lists have to exclude it rather than trusting each
   screen to remember.

   ── Some things never route through the line at all ───────────────────────

   Harassment and safety go straight to HR, whoever the manager is and whoever
   the manager's manager is. A grievance about conduct that arrives on the desk
   of somebody who plays football with the person it is about is a grievance
   that was never really raised. Those categories are marked `hrOnly` and the
   routing does not have an opinion about the org chart.

   ── Anonymity is deliberately not offered ─────────────────────────────────

   It cannot be honoured. Every escalation names a subject in order to be
   actionable at all — "somebody on the Lenovo evening team is underpaid" is
   not something HR can investigate without narrowing it to a person, at which
   point the anonymity is gone and the promise was a lie. What is offered
   instead is confidentiality, which is real: a named audience, and the manager
   is not in it. */

/** Where an escalation can be aimed, and what that means for routing. */
export const ESCALATION_CATEGORIES = {
  pay: {
    label: "Pay or hours",
    labelAr: "الأجر أو ساعات العمل",
    blurb: "Wrong pay, unpaid overtime, deductions you do not recognise.",
    hrOnly: false,
    slaDays: 5,
  },
  treatment: {
    label: "How I am being treated",
    labelAr: "طريقة التعامل معي",
    blurb: "Favouritism, being singled out, being spoken to badly.",
    hrOnly: false,
    slaDays: 3,
  },
  workload: {
    label: "Workload or scheduling",
    labelAr: "عبء العمل أو الجدولة",
    blurb: "Rosters that ignore your availability, no breaks, refused leave.",
    hrOnly: false,
    slaDays: 5,
  },
  /* Straight to HR. A grievance about conduct that lands on the desk of
     somebody who plays football with the person it is about was never really
     raised. */
  harassment: {
    label: "Harassment or discrimination",
    labelAr: "تحرش أو تمييز",
    blurb: "Goes straight to HR. It does not pass through anybody in your line.",
    hrOnly: true,
    slaDays: 1,
  },
  safety: {
    label: "Safety",
    labelAr: "السلامة",
    blurb: "Anything that could hurt somebody. Goes straight to HR.",
    hrOnly: true,
    slaDays: 1,
  },
  other: {
    label: "Something else",
    labelAr: "شيء آخر",
    blurb: "",
    hrOnly: false,
    slaDays: 5,
  },
};

export const ESCALATION_CODES = Object.keys(ESCALATION_CATEGORIES);
export const isEscalationCategory = (c) => Object.hasOwn(ESCALATION_CATEGORIES, c);
export const goesStraightToHr = (c) => Boolean(ESCALATION_CATEGORIES[c]?.hrOnly);

/**
 * Who hears it.
 *
 * The skip level — your manager's manager — for anything about the line, and HR
 * for the categories that must not touch the line at all. HR is also the
 * fallback when there is no skip level, because the top of a branch reporting
 * to nobody must not mean an escalation goes nowhere.
 *
 * @param {string} category
 * @param {{directManagerId?: string|null, skipManagerId?: string|null}} chain
 * @param {string[]} hrIds
 * @returns {{ok: true, audience: string[], why: string} | {ok: false, reason: string}}
 */
export function routeFor(category, chain = {}, hrIds = []) {
  if (!isEscalationCategory(category)) return { ok: false, reason: `Unknown category "${category}".` };

  if (goesStraightToHr(category)) {
    if (!hrIds.length) return { ok: false, reason: "No HR contact is configured, so this cannot be raised safely." };
    return { ok: true, audience: [...hrIds], why: "This goes to HR directly, not through anybody in your reporting line." };
  }

  const skip = chain.skipManagerId ? String(chain.skipManagerId) : "";
  if (skip) {
    return { ok: true, audience: [skip], why: "This goes to your manager's manager. Your own manager will not see it." };
  }

  if (!hrIds.length) return { ok: false, reason: "There is nobody above your manager and no HR contact configured." };
  return { ok: true, audience: [...hrIds], why: "There is nobody above your manager, so this goes to HR." };
}

/**
 * The people who must never see this, whatever list they are looking at.
 *
 * Returned as a list rather than left to each screen, because "remember to
 * exclude the manager" is a rule that holds until somebody adds a sixth screen.
 */
export function mustNotSee(chain = {}) {
  return [chain.directManagerId, chain.functionalManagerId, chain.dottedManagerId]
    .filter(Boolean)
    .map(String);
}

/** Everything wrong with an escalation somebody is trying to raise. */
export function checkEscalation(p = {}) {
  const problems = [];
  const warnings = [];

  if (!isEscalationCategory(p.category)) problems.push("Choose what this is about.");

  const detail = String(p.detail ?? "").trim();
  if (detail.length < 20) {
    /* Not gatekeeping. An escalation of four words cannot be investigated, and
       the person reading it has no way to ask a follow-up without revealing to
       the manager that something was raised. */
    problems.push("Say what happened, with enough detail that somebody can look into it without having to ask your manager.");
  }
  if (detail.length > 4000) problems.push("That is longer than this form can carry. Summarise it and offer to talk.");

  if (p.anonymous) {
    /* Offered by nobody, asked for by everybody. Saying why is better than a
       disabled checkbox. */
    warnings.push(
      "This cannot be raised anonymously — it names you so that somebody can actually look into it. " +
        "It is confidential instead: your manager is not told, and is not in the audience.",
    );
  }

  return { problems, warnings };
}

/** SLA for a category, in days. Harassment and safety are same-day. */
export const slaFor = (category) => ESCALATION_CATEGORIES[category]?.slaDays ?? 5;

/**
 * Everything wrong with this module's own wiring.
 *
 * The hrOnly check is the one that matters: a category that must bypass the
 * line but has a slow SLA is a promise the module does not keep.
 */
export function checkEscalations() {
  const problems = [];
  for (const [code, meta] of Object.entries(ESCALATION_CATEGORIES)) {
    if (!meta.label) problems.push(`${code} has no label.`);
    if (!meta.labelAr) problems.push(`${code} has no Arabic label.`);
    if (!Number.isFinite(meta.slaDays) || meta.slaDays < 1) problems.push(`${code} has no usable SLA.`);
    if (meta.hrOnly && meta.slaDays > 2) {
      problems.push(`${code} bypasses the line because it is urgent, but its SLA is ${meta.slaDays} days.`);
    }
  }
  return problems;
}

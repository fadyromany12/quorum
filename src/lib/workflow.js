/* The approval engine — one engine for every request type. Pure, no I/O.

   Leave, overtime, transfers, promotions, pay changes, resignations,
   terminations, no-show reports and letter requests all need the same things:
   an ordered or concurrent chain of approvers, delegation, escalation on SLA
   breach, withdrawal, partial grants, and a "waiting on me" inbox.

   Written per feature, that becomes N implementations that disagree — and the
   one they disagree with is whichever was written last and reviewed least. So
   the shape of a request is fixed here and per-type configuration supplies only
   the chain rule, the SLA and the validation.

   Four patterns the engine must express, because a naive approve/reject cannot:

     · Partial grant. An approver may allow fewer units than asked for, and the
       remainder stays available to the requester rather than being consumed.

     · Co-approval with a timeout default. Two approvers must *agree* a value;
       neither can overrule the other. Without a default a disagreement
       deadlocks forever; without the equality, seniority silently decides.

     · Withdrawal windows. The requester may withdraw unilaterally for a period,
       after which withdrawal itself needs approval.

     · Third-party initiation. Some requests are raised by someone who is
       neither the subject nor their manager — whoever noticed the no-show
       should be able to report it. */

import { addDays, daysBetween, todayStr } from "./dates.js";
import { approvalChain } from "./employee.js";
import { LEAVE_CODES, exitReasonsFor } from "./taxonomy.js";

/* ── Request types ──────────────────────────────────────────────────────────
   `consequence` is shown at the point of submission. An action with a side
   effect beyond itself must say so before it is taken: a confirmation that does
   not state what will happen is not consent. */

/**
 * One request type's configuration. Declared as a single shape with optional
 * members rather than left to inference: each entry below sets a different
 * subset, and inference would make them mutually incompatible types, so callers
 * could not ask `cfg.partial` without narrowing first.
 *
 * @typedef {object} RequestTypeConfig
 * @property {string} label
 * @property {string} chain functionalThenDirect | directOnly | coApproval | hrReview | hrThenFinance
 * @property {boolean} [partial] approver may grant fewer units than requested
 * @property {string} [unit] what the units are, e.g. "days"
 * @property {number} [slaDays] per-step target before it is overdue
 * @property {boolean} [withdrawableWhilePending]
 * @property {number} [withdrawableDays] unilateral window after raising
 * @property {boolean} [subjectIsRequester] self-service by default
 * @property {boolean} [anyoneMayRaise] no relationship to the subject required
 * @property {boolean} [requiresEvidence]
 * @property {string} [agreeOn] the field co-approvers must agree on
 * @property {number} [defaultAfterDays] timeout after which the proposal stands
 * @property {string} [consequence] side effect, disclosed at submission
 */

/** @type {Record<string, RequestTypeConfig>} */
export const REQUEST_TYPES = {
  leave: {
    label: "Leave request",
    chain: "functionalThenDirect",
    // Approvers may grant fewer days; unapproved days return to the balance.
    partial: true,
    unit: "days",
    slaDays: 3,
    // Withdrawable by the requester for as long as it is still pending.
    withdrawableWhilePending: true,
    subjectIsRequester: true,
  },
  overtime: {
    label: "Overtime request",
    chain: "directOnly",
    partial: true,
    unit: "hours",
    slaDays: 2,
    withdrawableWhilePending: true,
    subjectIsRequester: true,
  },
  resignation: {
    label: "Resignation",
    // Both managers must agree ONE last working day. Neither can overrule.
    chain: "coApproval",
    agreeOn: "lastWorkingDay",
    // If they have not agreed by then, the date the employee proposed stands.
    defaultAfterDays: 10,
    // Unilateral withdrawal for ten days; after that a manager must agree.
    withdrawableDays: 10,
    subjectIsRequester: true,
    consequence: "Starts your notice period and opens clearance.",
  },
  transfer: {
    label: "Transfer",
    chain: "coApproval",
    agreeOn: "effectiveDate",
    defaultAfterDays: 14,
    slaDays: 7,
  },
  termination: {
    label: "Termination",
    chain: "hrReview",
    requiresEvidence: true,
    slaDays: 5,
    consequence: "Goes to HR with your evidence before anything happens.",
  },
  noShow: {
    label: "No-show report",
    chain: "hrReview",
    // Anyone may raise this, manager or not — whoever noticed.
    anyoneMayRaise: true,
    slaDays: 1,
    consequence: "Puts their payment on hold and opens clearance so equipment can be recovered.",
  },
  payChange: {
    label: "Pay change",
    chain: "hrThenFinance",
    slaDays: 5,
  },
  letterRequest: {
    label: "HR letter",
    chain: "hrReview",
    slaDays: 5,
    subjectIsRequester: true,
  },
  /* The verified editability tier (see profile-policy.js): the employee
     proposes, HR checks against a document, and only approval applies it.
     These fields drive entitlements or payment destinations, so an immediate
     self-edit here is an unattributed change to something that moves money. */
  profileChange: {
    label: "Profile change",
    chain: "hrReview",
    slaDays: 3,
    subjectIsRequester: true,
    withdrawableWhilePending: true,
    consequence: "Applies only after HR verifies it against your documents.",
  },
  /* Two agents trade shifts. The lead approves, because coverage is theirs to
     answer for — the swap may be fine for the two people and leave 14:00 three
     short, and the coverage check runs before the request is even offered.

     Deliberately not co-approval between the two agents. The colleague's
     agreement is a precondition captured when the swap is raised, not a second
     approval step: modelling it as one would leave a request sitting on an
     agent who has no queue, no SLA and no reason to look. */
  /* Four changes in one approval: job, org, access and pay. They were four
     unrelated edits, which is how someone ends up with a Team Leader title and
     an Agent's login. hrThenFinance because a promotion is a pay change plus
     more, and finance owns the paybill.

     Not partial-capable, deliberately: there is no coherent half of this. You
     cannot grant the title and withhold the access — that is precisely the
     broken state it exists to prevent. */
  promotion: {
    label: "Promotion",
    chain: "hrThenFinance",
    slaDays: 5,
    consequence: "Changes the job title, the reporting line, the login role and the salary together, on the effective date.",
  },
  shiftSwap: {
    label: "Shift swap",
    chain: "directOnly",
    slaDays: 2,
    subjectIsRequester: true,
    withdrawableWhilePending: true,
    consequence: "Swaps the two shifts on the roster once your lead approves.",
  },
};

export const isRequestType = (t) => Object.hasOwn(REQUEST_TYPES, t);

export const STATUSES = ["draft", "pending", "approved", "partial", "rejected", "withdrawn", "autoResolved"];

/* Step states. "skipped" exists for a step made irrelevant by an earlier
   rejection — distinct from "rejected", because the approver did not act. */
export const STEP_STATES = ["pending", "approved", "rejected", "skipped"];

/* ── Chain construction ─────────────────────────────────────────────────────*/

/**
 * One approver's slot in a chain.
 *
 * @typedef {object} Step
 * @property {string} [id]
 * @property {number} order steps sharing an order are decided together
 * @property {string} kind sequential | co | any
 * @property {string} approverId
 * @property {string} state pending | approved | rejected | skipped
 * @property {number|null} decidedAt
 * @property {string|null} decidedBy
 * @property {string} note
 * @property {number|null} grantedUnits
 * @property {string|null} proposedValue
 */

/**
 * Build the approval chain for a request.
 *
 * @param {string} type
 * @param {{directManagerId?: string|null, functionalManagerId?: string|null, dottedManagerId?: string|null}} subject
 * @param {{hrIds?: string[], financeIds?: string[]}} [roles]
 * @returns {{ok: true, steps: Step[]} | {ok: false, reason: string}}
 */
export function chainFor(type, subject, roles = {}) {
  const cfg = REQUEST_TYPES[type];
  if (!cfg) return { ok: false, reason: `Unknown request type "${type}".` };

  const step = (approverId, order, kind = "sequential") => ({
    order, kind, approverId, state: "pending",
    decidedAt: null, decidedBy: null, note: "",
    grantedUnits: null, proposedValue: null,
  });

  if (cfg.chain === "functionalThenDirect") {
    // Functional (client-account) manager first when they differ from Direct.
    const r = approvalChain(subject);
    if (!r.ok) return r;
    return { ok: true, steps: r.chain.map((id, i) => step(id, i)) };
  }

  if (cfg.chain === "directOnly") {
    const direct = subject?.directManagerId;
    if (!direct) {
      return { ok: false, reason: "No direct manager assigned — assign one before raising this." };
    }
    return { ok: true, steps: [step(direct, 0)] };
  }

  if (cfg.chain === "coApproval") {
    /* Both managers act concurrently and must agree. Falling back to a single
       approver when there is only one is deliberate: a one-manager co-approval
       is just an approval, and inventing a second approver to satisfy the shape
       would block the request on somebody arbitrary. */
    const ids = [subject?.directManagerId, subject?.dottedManagerId || subject?.functionalManagerId]
      .filter(Boolean)
      .filter((id, i, a) => a.indexOf(id) === i);
    if (!ids.length) return { ok: false, reason: "No manager assigned — assign one before raising this." };
    return { ok: true, steps: ids.map((id) => step(id, 0, "co")) };
  }

  if (cfg.chain === "hrReview") {
    const hr = roles.hrIds || [];
    if (!hr.length) return { ok: false, reason: "No HR approver is configured." };
    // Any one HR approver may act; the rest are marked skipped on decision.
    return { ok: true, steps: hr.map((id) => step(id, 0, "any")) };
  }

  if (cfg.chain === "hrThenFinance") {
    const hr = roles.hrIds || [];
    const fin = roles.financeIds || [];
    if (!hr.length) return { ok: false, reason: "No HR approver is configured." };
    if (!fin.length) return { ok: false, reason: "No finance approver is configured." };
    return {
      ok: true,
      steps: [...hr.map((id) => step(id, 0, "any")), ...fin.map((id) => step(id, 1, "any"))],
    };
  }

  return { ok: false, reason: `Unknown chain rule "${cfg.chain}".` };
}

/* ── Delegation ─────────────────────────────────────────────────────────────*/

/**
 * Authority for one person to act for another. Blank dates mean a standing
 * arrangement in force until revoked — the normal shape for a permanent deputy,
 * not an edge case.
 *
 * @typedef {object} Delegation
 * @property {string} approverId
 * @property {string} delegateId
 * @property {string} [from] YYYY-MM-DD, blank = already in force
 * @property {string} [to] YYYY-MM-DD, blank = until revoked
 * @property {boolean} [revoked]
 */

/**
 * Who may actually act for an approver right now.
 *
 * Follows a delegation chain, so a delegate who has themselves delegated hands
 * on. Cycle-safe: A→B→A terminates at A rather than looping, because a mutual
 * delegation is a data-entry mistake and must not hang a request.
 *
 * A delegation with no `from`/`to` is a standing arrangement and runs until
 * revoked — that is the common case for a permanent deputy, not an edge case.
 *
 * @param {string} approverId
 * @param {Delegation[]} [delegations]
 * @param {string} [today] YYYY-MM-DD
 * @returns {string} the id that may act
 */
export function effectiveApprover(approverId, delegations = /** @type {Delegation[]} */ ([]), today = todayStr()) {
  const active = (delegations || []).filter((d) => {
    if (d.revoked || !d.approverId || !d.delegateId) return false;
    if (d.from && daysBetween(d.from, today) < 0) return false;
    if (d.to && daysBetween(today, d.to) < 0) return false;
    return true;
  });
  const byApprover = new Map(active.map((d) => [d.approverId, d.delegateId]));

  let cur = approverId;
  const seen = new Set([cur]);
  while (byApprover.has(cur)) {
    const next = byApprover.get(cur);
    if (seen.has(next)) break; // mutual or circular delegation — stop here
    cur = next;
    seen.add(cur);
  }
  return cur;
}

/**
 * Every id that may act for this approver: themselves, plus their delegate.
 * @param {string} approverId
 * @param {Delegation[]} [delegations]
 * @param {string} [today]
 * @returns {string[]}
 */
export function actingIdsFor(approverId, delegations, today) {
  const eff = effectiveApprover(approverId, delegations, today);
  return eff === approverId ? [approverId] : [approverId, eff];
}

/**
 * A request, as the engine sees it. Persistence adds columns of its own; these
 * are the fields the rules actually read.
 *
 * @typedef {object} Request
 * @property {string} [id]
 * @property {string} type
 * @property {Step[]} steps
 * @property {string} [raisedOn] YYYY-MM-DD
 * @property {string} [raisedById]
 * @property {number|null} [requestedUnits]
 * @property {string|null} [proposedValue]
 * @property {number|null} [withdrawnAt]
 * @property {number|null} [autoResolvedAt]
 *
 * Persistence fields that ride along through the engine's spreads untouched.
 * Declared optional so a stored request stays assignable to this shape and the
 * boundary needs no cast — the engine never reads them, but it must not lose
 * them either.
 * @property {string} [subjectId]
 * @property {unknown} [payload]
 * @property {number|null} [settledAt]
 * @property {number} [createdAt]
 * @property {unknown} [subject]
 */

/* ── Status ─────────────────────────────────────────────────────────────────*/

const cfgOf = (r) => REQUEST_TYPES[r?.type] || {};

/**
 * Steps at the lowest order that still has something pending.
 *
 * Returns the whole order group, decided members included, because a co-approval
 * order is one unit of work — callers filter to `pending` when they need only
 * what is outstanding.
 *
 * @param {{steps?: Step[]}} request
 * @returns {Step[]}
 */
export function activeSteps(request) {
  const steps = request?.steps || [];
  const cfg = cfgOf(request);

  /* Co-approval is one order that stays open until the proposals actually
     match. Everyone having approved is not the same as everyone agreeing, and
     closing on the count alone would settle a disagreement in silence. */
  if (cfg.chain === "coApproval") {
    if (steps.some((s) => s.state === "rejected")) return [];
    const a = agreement(request);
    return a.applicable && a.agreed ? [] : steps;
  }

  const orders = [...new Set(steps.map((s) => s.order))].sort((a, b) => a - b);
  for (const o of orders) {
    const at = steps.filter((s) => s.order === o);
    if (at.some((s) => s.state === "pending")) return at;
  }
  return [];
}

/**
 * Steps a person may act on right now.
 *
 * Ordinarily the pending ones. For a co-approval where everyone has approved but
 * on *different* values, an already-approved step is still actionable: revising a
 * proposal is the only way out short of the timeout, so the step returns to its
 * owner rather than leaving them with an unresolvable request and no control.
 *
 * @param {{steps?: Step[], type?: string}} request
 * @returns {Step[]}
 */
export const pendingSteps = (request) => {
  const live = activeSteps(request);
  if (cfgOf(request).chain === "coApproval") {
    return live.filter((s) => s.state !== "rejected" && s.state !== "skipped");
  }
  return live.filter((s) => s.state === "pending");
};

/**
 * Derived status. Never stored — a status column and a step list can disagree,
 * and when they do it is the column that gets trusted and the steps that are
 * right.
 */
export function statusOf(/** @type {Request|null|undefined} */ request) {
  if (!request) return "draft";
  if (request.withdrawnAt) return "withdrawn";
  const steps = request.steps || [];
  if (!steps.length) return "draft";

  if (steps.some((s) => s.state === "rejected")) return "rejected";

  const cfg = cfgOf(request);
  if (cfg.chain === "coApproval") {
    /* Agreement, not arithmetic. Two approvals of different values leaves the
       request pending — that is the deadlock the timeout default exists to
       break, and reporting it as approved would let the requester's proposal win
       instantly and silently, bypassing the agreement window entirely. */
    const a = agreement(request);
    if (!(a.applicable && a.agreed)) return "pending";
    return request.autoResolvedAt ? "autoResolved" : "approved";
  }

  // "any" steps: one approval at an order satisfies that order.
  const orders = [...new Set(steps.map((s) => s.order))];
  const satisfied = orders.every((o) => {
    const at = steps.filter((s) => s.order === o);
    return at.some((s) => s.state === "approved") || at.every((s) => s.state === "skipped");
  });
  if (!satisfied) return "pending";

  if (cfg.partial && request.requestedUnits != null) {
    const granted = grantedUnitsOf(request);
    if (granted != null && granted < request.requestedUnits) return "partial";
  }
  return "approved";
}

/**
 * Units actually granted, for a partial-capable type.
 *
 * The minimum across approvers, not the last word: each approver may reduce
 * further, and a later approver being more generous cannot restore days an
 * earlier one declined.
 */
export function grantedUnitsOf(/** @type {Request} */ request) {
  if (!cfgOf(request).partial) return null;
  const grants = (request?.steps || [])
    .filter((s) => s.state === "approved" && s.grantedUnits != null)
    .map((s) => Number(s.grantedUnits));
  if (!grants.length) return null;
  return Math.min(...grants);
}

/** Units asked for but not granted — these stay available to the requester. */
export function unusedUnitsOf(request) {
  const granted = grantedUnitsOf(request);
  if (granted == null || request?.requestedUnits == null) return null;
  return Math.max(0, Number(request.requestedUnits) - granted);
}

/* ── Deciding ───────────────────────────────────────────────────────────────*/

/**
 * Record one approver's decision, returning a new request rather than mutating.
 *
 * @param {Request} request
 * @param {{approverId: string, actorId?: string, decision: "approve"|"reject",
 *          grantedUnits?: number, proposedValue?: string, note?: string}} action
 * @param {{delegations?: Array<object>, today?: string, nowMs?: number}} [ctx]
 * @returns {{ok: true, request: Request} | {ok: false, reason: string}}
 */
export function decide(request, action, ctx = {}) {
  const { delegations = [], today = todayStr(), nowMs = Date.now() } = ctx;
  const cfg = cfgOf(request);
  const status = statusOf(request);

  if (status !== "pending") return { ok: false, reason: `This request is already ${status}.` };
  if (!["approve", "reject"].includes(action?.decision)) {
    return { ok: false, reason: "Decision must be approve or reject." };
  }

  const step = pendingSteps(request).find((s) => s.approverId === action.approverId);
  if (!step) {
    // Either not their turn, or not their request at all. Both are the same
    // answer to the caller; distinguishing them would leak the chain.
    return { ok: false, reason: "This request is not waiting on you." };
  }

  // Delegation: the acting user must be the approver or their active delegate.
  const allowed = actingIdsFor(step.approverId, delegations, today);
  if (action.actorId && !allowed.includes(action.actorId)) {
    return { ok: false, reason: "You are not the approver, and no delegation covers you." };
  }

  let grantedUnits = null;
  if (action.decision === "approve" && cfg.partial && request.requestedUnits != null) {
    const asked = Number(request.requestedUnits);
    const g = action.grantedUnits == null ? asked : Number(action.grantedUnits);
    if (!Number.isFinite(g) || g <= 0) return { ok: false, reason: "Approve at least one, or reject." };
    // Granting *more* than was asked for is not generosity, it is a typo — and
    // it would consume balance the requester never agreed to spend.
    if (g > asked) return { ok: false, reason: `You cannot approve more than the ${asked} requested.` };
    grantedUnits = g;
  }

  let proposedValue = null;
  if (cfg.chain === "coApproval") {
    proposedValue = action.proposedValue ?? request.proposedValue ?? null;
    if (action.decision === "approve" && !proposedValue) {
      return { ok: false, reason: `Propose a ${cfg.agreeOn} to agree on.` };
    }
  }

  const decided = {
    ...step,
    state: action.decision === "approve" ? "approved" : "rejected",
    decidedAt: nowMs,
    decidedBy: action.actorId || step.approverId,
    note: String(action.note ?? ""),
    grantedUnits,
    proposedValue,
  };

  let steps = (request.steps || []).map((s) => (s === step ? decided : s));

  /* An "any" step satisfied by one approver leaves the rest with nothing to do.
     Marking them skipped keeps their inboxes honest — a request nobody needs to
     act on must not sit in three queues looking urgent. */
  if (step.kind === "any" && action.decision === "approve") {
    steps = steps.map((s) =>
      s.order === step.order && s.state === "pending" && s !== decided ? { ...s, state: "skipped" } : s);
  }
  // A rejection ends the request; later steps never become relevant.
  if (action.decision === "reject") {
    steps = steps.map((s) => (s.state === "pending" && s !== decided ? { ...s, state: "skipped" } : s));
  }

  return { ok: true, request: { ...request, steps } };
}

/* ── Co-approval agreement ──────────────────────────────────────────────────*/

/**
 * Whether co-approvers have agreed, and on what.
 *
 * Agreement means every approver approved *and* proposed the same value. Two
 * approvals of different dates is not agreement — it is the disagreement the
 * timeout exists to break.
 */
export function agreement(/** @type {Request} */ request) {
  const cfg = cfgOf(request);
  if (cfg.chain !== "coApproval") return { applicable: false };
  const steps = request?.steps || [];
  const approved = steps.filter((s) => s.state === "approved");
  if (approved.length < steps.length) {
    return { applicable: true, agreed: false, pending: steps.length - approved.length, values: approved.map((s) => s.proposedValue) };
  }
  const values = [...new Set(approved.map((s) => String(s.proposedValue ?? "")))];
  return {
    applicable: true,
    agreed: values.length === 1,
    value: values.length === 1 ? values[0] : null,
    values,
    pending: 0,
  };
}

/**
 * Apply the timeout default when co-approvers have not agreed in time.
 *
 * The requester's own proposal stands. That is the fair default precisely
 * because it is not either approver's — letting one side's figure win on a
 * timer would make the deadlock a tactic.
 *
 * @param {Request} request
 * @param {string} [today]
 * @param {number} [nowMs]
 * @returns {{applies: false} | {applies: true, request: Request, value: string}}
 */
export function autoResolve(request, today = todayStr(), nowMs = Date.now()) {
  const cfg = cfgOf(request);
  if (cfg.chain !== "coApproval" || !cfg.defaultAfterDays) return { applies: false };
  if (statusOf(request) !== "pending") return { applies: false };
  if (!request.raisedOn) return { applies: false };

  const elapsed = daysBetween(request.raisedOn, today);
  if (Number.isNaN(elapsed) || elapsed < cfg.defaultAfterDays) return { applies: false };

  const value = request.proposedValue;
  if (!value) return { applies: false };

  const steps = (request.steps || []).map((s) =>
    s.state === "pending"
      ? { ...s, state: "approved", decidedAt: nowMs, decidedBy: "system",
          proposedValue: value, note: `No agreement within ${cfg.defaultAfterDays} days — the proposed ${cfg.agreeOn} stands.` }
      : { ...s, proposedValue: value });

  return { applies: true, value, request: { ...request, steps, autoResolvedAt: nowMs } };
}

/** The day a pending co-approval will resolve itself, or "" if never. */
export function autoResolveOn(request) {
  const cfg = cfgOf(request);
  if (cfg.chain !== "coApproval" || !cfg.defaultAfterDays || !request?.raisedOn) return "";
  return addDays(request.raisedOn, cfg.defaultAfterDays);
}

/* ── Withdrawal ─────────────────────────────────────────────────────────────*/

/**
 * Whether the requester may withdraw unilaterally.
 *
 * Two shapes: withdrawable for as long as it is pending (leave), or for a fixed
 * window after raising it (resignation — ten days, then a manager must agree).
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function canWithdraw(/** @type {Request} */ request, /** @type {string|undefined} */ actorId, today = todayStr()) {
  const cfg = cfgOf(request);
  const status = statusOf(request);
  if (status === "withdrawn") return { ok: false, reason: "Already withdrawn." };
  if (actorId && request?.raisedById && actorId !== request.raisedById) {
    return { ok: false, reason: "Only the person who raised this can withdraw it." };
  }

  if (cfg.withdrawableDays) {
    if (!request?.raisedOn) return { ok: false, reason: "This request has no raised date." };
    const elapsed = daysBetween(request.raisedOn, today);
    if (Number.isNaN(elapsed)) return { ok: false, reason: "This request has no valid raised date." };
    if (elapsed > cfg.withdrawableDays) {
      return {
        ok: false,
        reason: `The ${cfg.withdrawableDays}-day window has passed — your manager must agree to withdraw this.`,
      };
    }
    return { ok: true };
  }

  if (cfg.withdrawableWhilePending) {
    if (status !== "pending") return { ok: false, reason: `This request is already ${status}.` };
    return { ok: true };
  }

  return { ok: false, reason: "This request type cannot be withdrawn." };
}

/* ── SLA and escalation ─────────────────────────────────────────────────────*/

/**
 * How overdue a pending request is.
 *
 * Measured from when it reached its current step, not from when it was raised:
 * an approver who received it yesterday has not breached an SLA because someone
 * before them sat on it for a week. Their delay is theirs.
 */
export function slaFor(/** @type {Request} */ request, today = todayStr()) {
  const cfg = cfgOf(request);
  if (!cfg.slaDays || statusOf(request) !== "pending") return null;

  const priorDecisions = (request.steps || [])
    .filter((s) => s.decidedAt)
    .map((s) => s.decidedAt);
  const startedMs = priorDecisions.length ? Math.max(...priorDecisions) : null;
  const startedOn = startedMs
    ? new Date(startedMs).toISOString().slice(0, 10)
    : request.raisedOn;

  const waited = daysBetween(startedOn, today);
  if (Number.isNaN(waited)) return null;
  return {
    waitedDays: waited,
    slaDays: cfg.slaDays,
    dueOn: addDays(startedOn, cfg.slaDays),
    breached: waited > cfg.slaDays,
    overdueBy: Math.max(0, waited - cfg.slaDays),
    // Only those who have not yet acted — naming an approver who already
    // approved as "waiting on" is how escalation emails reach the wrong person.
    waitingOn: pendingSteps(request).map((s) => s.approverId),
  };
}

/** Pending requests past their SLA, worst first. */
export function escalations(/** @type {Request[]} */ requests, today = todayStr()) {
  return (requests || [])
    .map((r) => ({ request: r, sla: slaFor(r, today) }))
    .filter((x) => x.sla?.breached)
    .sort((a, b) => b.sla.overdueBy - a.sla.overdueBy);
}

/* ── Inbox ──────────────────────────────────────────────────────────────────*/

/**
 * Requests genuinely waiting on this person, including those they hold by
 * delegation.
 *
 * A step already satisfied by someone else, or skipped, is excluded — an inbox
 * that shows work nobody needs to do is an inbox people stop reading.
 */
export function inboxFor(approverId, requests, { delegations = /** @type {Delegation[]} */ ([]), today = todayStr() } = {}) {
  const out = [];
  for (const r of requests || []) {
    if (statusOf(r) !== "pending") continue;
    for (const s of pendingSteps(r)) {
      const acting = actingIdsFor(s.approverId, delegations, today);
      if (!acting.includes(approverId)) continue;
      out.push({
        request: r,
        step: s,
        // Flagged so the UI can say "you are seeing this as X's delegate"
        // rather than implying it is the viewer's own approval.
        viaDelegation: s.approverId !== approverId,
        sla: slaFor(r, today),
      });
      break; // one entry per request, even when both co-approvers are delegated
    }
  }
  // Most overdue first; a fresh request should not sit above a breached one.
  return out.sort((a, b) => (b.sla?.overdueBy ?? 0) - (a.sla?.overdueBy ?? 0));
}

/* ── Raising ────────────────────────────────────────────────────────────────*/

/**
 * Whether this person may raise this type of request about this subject.
 *
 * Most types are either self-service or a manager acting on a report. Two are
 * deliberately open: a no-show report may come from anyone who noticed, because
 * requiring it to come from the manager means it does not get reported when the
 * manager is the one who has not noticed.
 *
 * @param {string} type
 * @param {{actorId?: string, actorRole?: string, subjectId?: string, subordinateIds?: string[]}} ctx
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function canRaise(type, { actorId, actorRole, subjectId, subordinateIds = [] }) {
  const cfg = REQUEST_TYPES[type];
  if (!cfg) return { ok: false, reason: `Unknown request type "${type}".` };
  if (cfg.anyoneMayRaise) return { ok: true };

  if (cfg.subjectIsRequester) {
    if (actorId === subjectId) return { ok: true };
    if (["SuperAdmin", "HRBusinessPartner"].includes(actorRole)) return { ok: true };
    return { ok: false, reason: "You can only raise this for yourself." };
  }

  if (actorId === subjectId) return { ok: false, reason: "You cannot raise this about yourself." };
  if (["SuperAdmin", "HRBusinessPartner"].includes(actorRole)) return { ok: true };
  if (subordinateIds.includes(subjectId)) return { ok: true };
  return { ok: false, reason: "You can only raise this for someone who reports to you." };
}

/* ── Payload validation ─────────────────────────────────────────────────────
   The payload is the only part of a request that is free-form, and it travelled
   through a browser. Two things go wrong when it is stored unchecked:

     A value nobody validated becomes a document nobody validated. An HR letter
     asked for with kind "salary " or "Salary" or "bonus" used to render a
     titleless, salary-less certificate rather than failing — a wrong document
     that looks official is worse than an error message.

     And a JSON column with no ceiling is a place to put a megabyte.

   Enumerated values are checked here rather than at render time so the refusal
   reaches the person who can fix it, at the moment they can fix it. */

/** Values an enumerated payload field may take, by request type and field.

    Leave types and exit reasons come from the taxonomy rather than being
    retyped here — a validator with its own copy of the list is a validator that
    rejects the option the dropdown just offered. */
export const PAYLOAD_ENUMS = {
  letterRequest: { kind: ["bank", "employment", "salary"] },
  leave: { leaveType: LEAVE_CODES },
  resignation: { reason: exitReasonsFor("Resignation") },
  termination: { reason: exitReasonsFor("Termination") },
};

/** Hard ceiling on a serialized payload. Generous for a form, useless as a store. */
export const MAX_PAYLOAD_BYTES = 8 * 1024;

/**
 * Check a request payload before it is persisted.
 *
 * @param {string} type
 * @param {Record<string, unknown>} payload
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkPayload(type, payload) {
  const p = payload ?? {};
  if (typeof p !== "object" || Array.isArray(p)) {
    return { ok: false, reason: "The request details must be an object." };
  }

  let size;
  try {
    size = JSON.stringify(p).length;
  } catch {
    // Circular or non-serializable — it would fail at the database anyway.
    return { ok: false, reason: "The request details could not be read." };
  }
  if (size > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: "The request details are too large." };
  }

  const enums = PAYLOAD_ENUMS[type];
  if (enums) {
    for (const [field, allowed] of Object.entries(enums)) {
      if (p[field] === undefined) continue; // absence is the type's own business
      if (!allowed.includes(p[field])) {
        return { ok: false, reason: `"${field}" must be one of: ${allowed.join(", ")}.` };
      }
    }
  }
  return { ok: true };
}

/** Whether a value is a usable choice for an enumerated payload field. */
export const isPayloadChoice = (type, field, value) =>
  (PAYLOAD_ENUMS[type]?.[field] ?? []).includes(value);

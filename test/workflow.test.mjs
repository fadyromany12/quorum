/* The approval engine.

   The cases worth reading are the ones a naive approve/reject cannot express:
   a partial grant that leaves the remainder available, two approvers who must
   agree and neither of whom can overrule the other, a deadlock broken by a
   timeout without letting either side's figure win, and an inbox that stays
   honest when work is delegated or already satisfied by someone else. */

const W = await import("../src/lib/workflow.js");
const { addDays, todayStr } = await import("../src/lib/dates.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

const T = todayStr();
const ago = (n) => addDays(T, -n);

const AGENT = { id: "agent", directManagerId: "direct", functionalManagerId: "functional", dottedManagerId: "dotted" };
const SIMPLE = { id: "simple", directManagerId: "direct" };
const ROLES = { hrIds: ["hr1", "hr2"], financeIds: ["fin1"] };

const mk = (type, subject, over = {}) => {
  const c = W.chainFor(type, subject, ROLES);
  if (!c.ok) throw new Error(`chain failed: ${c.reason}`);
  return { type, subjectId: subject.id, raisedById: subject.id, raisedOn: T, steps: c.steps, ...over };
};

console.log("\n── Chain construction ──");
eq("leave routes functional then direct",
  W.chainFor("leave", AGENT, ROLES).steps.map((s) => s.approverId), ["functional", "direct"]);
eq("and orders them", W.chainFor("leave", AGENT, ROLES).steps.map((s) => s.order), [0, 1]);
eq("one approver when functional equals direct",
  W.chainFor("leave", { id: "x", directManagerId: "d", functionalManagerId: "d" }, ROLES).steps.length, 1);
eq("no direct manager blocks the chain",
  W.chainFor("leave", { id: "x" }, ROLES),
  { ok: false, reason: "No direct manager assigned — assign one before requesting leave." });
eq("overtime goes to the direct manager only",
  W.chainFor("overtime", AGENT, ROLES).steps.map((s) => s.approverId), ["direct"]);
eq("resignation is co-approval at the same order",
  W.chainFor("resignation", AGENT, ROLES).steps.map((s) => [s.approverId, s.order, s.kind]),
  [["direct", 0, "co"], ["dotted", 0, "co"]]);
// A one-manager co-approval is just an approval; inventing a second approver
// would block the request on somebody arbitrary.
eq("co-approval with one manager degrades to one step",
  W.chainFor("resignation", SIMPLE, ROLES).steps.length, 1);
eq("duplicate managers are not asked twice",
  W.chainFor("resignation", { id: "x", directManagerId: "d", dottedManagerId: "d" }, ROLES).steps.length, 1);
eq("hr review offers every HR approver at one order",
  W.chainFor("noShow", AGENT, ROLES).steps.map((s) => [s.approverId, s.kind]),
  [["hr1", "any"], ["hr2", "any"]]);
eq("pay change is HR then finance",
  W.chainFor("payChange", AGENT, ROLES).steps.map((s) => [s.approverId, s.order]),
  [["hr1", 0], ["hr2", 0], ["fin1", 1]]);
eq("missing finance approvers is refused",
  W.chainFor("payChange", AGENT, { hrIds: ["hr1"] }),
  { ok: false, reason: "No finance approver is configured." });
eq("unknown type is refused", W.chainFor("nonsense", AGENT, ROLES).ok, false);

console.log("\n── Sequential approval ──");
{
  let r = mk("leave", AGENT, { requestedUnits: 5 });
  eq("starts pending", W.statusOf(r), "pending");
  eq("waiting on the functional manager first", W.pendingSteps(r).map((s) => s.approverId), ["functional"]);

  // The second approver cannot jump the queue.
  eq("the later approver cannot act yet",
    W.decide(r, { approverId: "direct", actorId: "direct", decision: "approve" }),
    { ok: false, reason: "This request is not waiting on you." });
  // Nor can a stranger.
  eq("a stranger cannot act",
    W.decide(r, { approverId: "someone", actorId: "someone", decision: "approve" }).ok, false);

  r = W.decide(r, { approverId: "functional", actorId: "functional", decision: "approve" }, { today: T }).request;
  eq("still pending after the first approval", W.statusOf(r), "pending");
  eq("now waiting on the direct manager", W.pendingSteps(r).map((s) => s.approverId), ["direct"]);

  r = W.decide(r, { approverId: "direct", actorId: "direct", decision: "approve" }, { today: T }).request;
  eq("approved once the chain completes", W.statusOf(r), "approved");
  eq("full grant when nobody reduced it", W.grantedUnitsOf(r), 5);
  eq("nothing unused", W.unusedUnitsOf(r), 0);
  eq("a decided request cannot be decided again",
    W.decide(r, { approverId: "direct", actorId: "direct", decision: "reject" }).ok, false);
}

console.log("\n── Rejection ends it ──")
{
  let r = mk("leave", AGENT, { requestedUnits: 5 });
  r = W.decide(r, { approverId: "functional", actorId: "functional", decision: "reject", note: "Coverage" }, { today: T }).request;
  eq("rejected", W.statusOf(r), "rejected");
  // Later steps never become relevant, and must not sit in anyone's inbox.
  eq("remaining steps are skipped, not left pending",
    r.steps.map((s) => s.state), ["rejected", "skipped"]);
  eq("the note is kept", r.steps[0].note, "Coverage");
  eq("nothing is waiting on anyone", W.pendingSteps(r), []);
}

console.log("\n── Partial grant ──");
{
  let r = mk("leave", AGENT, { requestedUnits: 5 });
  r = W.decide(r, { approverId: "functional", actorId: "functional", decision: "approve", grantedUnits: 3 }, { today: T }).request;
  r = W.decide(r, { approverId: "direct", actorId: "direct", decision: "approve", grantedUnits: 5 }, { today: T }).request;
  eq("status reflects the partial grant", W.statusOf(r), "partial");
  // The minimum across approvers: a later, more generous approver cannot
  // restore days an earlier one declined.
  eq("the lowest grant wins", W.grantedUnitsOf(r), 3);
  // The days nobody approved stay available rather than being consumed or lost.
  eq("unapproved days remain available", W.unusedUnitsOf(r), 2);
}
eq("granting more than requested is refused as a typo",
  W.decide(mk("leave", AGENT, { requestedUnits: 5 }),
    { approverId: "functional", actorId: "functional", decision: "approve", grantedUnits: 9 }, { today: T }),
  { ok: false, reason: "You cannot approve more than the 5 requested." });
eq("granting zero is refused — reject instead",
  W.decide(mk("leave", AGENT, { requestedUnits: 5 }),
    { approverId: "functional", actorId: "functional", decision: "approve", grantedUnits: 0 }, { today: T }),
  { ok: false, reason: "Approve at least one, or reject." });
eq("omitting the grant approves in full",
  W.grantedUnitsOf(W.decide(mk("overtime", SIMPLE, { requestedUnits: 4 }),
    { approverId: "direct", actorId: "direct", decision: "approve" }, { today: T }).request), 4);

console.log("\n── 'Any one of' approval ──");
{
  let r = mk("noShow", AGENT, { raisedById: "bystander" });
  eq("both HR approvers are waiting", W.pendingSteps(r).map((s) => s.approverId), ["hr1", "hr2"]);
  r = W.decide(r, { approverId: "hr1", actorId: "hr1", decision: "approve" }, { today: T }).request;
  eq("one approval satisfies the order", W.statusOf(r), "approved");
  // An inbox that shows work nobody needs to do is an inbox people stop reading.
  eq("the other approver's step is skipped", r.steps.find((s) => s.approverId === "hr2").state, "skipped");
  eq("and it leaves their inbox", W.inboxFor("hr2", [r]).length, 0);
}

console.log("\n── Co-approval: neither can overrule ──");
{
  let r = mk("resignation", AGENT, { proposedValue: "2026-09-30" });
  eq("both managers are waiting", W.pendingSteps(r).map((s) => s.approverId).sort(), ["direct", "dotted"]);

  r = W.decide(r, { approverId: "direct", actorId: "direct", decision: "approve", proposedValue: "2026-09-30" }, { today: T }).request;
  // One approval is not agreement — the other manager still has to act.
  eq("one approval leaves it pending", W.statusOf(r), "pending");
  eq("agreement not yet reached", W.agreement(r).agreed, false);
  eq("and it says who is outstanding", W.agreement(r).pending, 1);

  r = W.decide(r, { approverId: "dotted", actorId: "dotted", decision: "approve", proposedValue: "2026-09-30" }, { today: T }).request;
  eq("matching proposals are agreement", W.agreement(r).agreed, true);
  eq("on the agreed value", W.agreement(r).value, "2026-09-30");
  eq("and the request is approved", W.statusOf(r), "approved");
}
{
  /* Two approvals of *different* dates is not agreement. This block exists
     because an earlier version counted approvals without comparing values, so a
     disagreement reported as "approved" and settled instantly — which let the
     requester's proposal win in silence and bypassed the whole agreement window.
     Asserting agreement() alone did not catch it; the status has to be checked. */
  let r = mk("resignation", AGENT, { proposedValue: "2026-09-30" });
  r = W.decide(r, { approverId: "direct", actorId: "direct", decision: "approve", proposedValue: "2026-09-30" }, { today: T }).request;
  r = W.decide(r, { approverId: "dotted", actorId: "dotted", decision: "approve", proposedValue: "2026-10-15" }, { today: T }).request;
  eq("differing proposals are not agreement", W.agreement(r).agreed, false);
  eq("both values are reported", W.agreement(r).values.sort(), ["2026-09-30", "2026-10-15"]);
  // The one that matters: everyone approved, but it must NOT be approved.
  eq("a disagreement stays pending", W.statusOf(r), "pending");
  eq("so the timeout can still break it", W.autoResolve({ ...r, raisedOn: ago(11) }, T).applies, true);
  // Each approver gets their step back, because revising is the only way out
  // short of waiting for the timeout.
  eq("both steps become actionable again",
    W.pendingSteps(r).map((s) => s.approverId).sort(), ["direct", "dotted"]);
  // And one of them revising to match settles it.
  const fixed = W.decide(r, { approverId: "dotted", actorId: "dotted", decision: "approve", proposedValue: "2026-09-30" }, { today: T }).request;
  eq("revising to match settles it", W.statusOf(fixed), "approved");
  eq("on the agreed value", W.agreement(fixed).value, "2026-09-30");
  eq("and nothing is left waiting", W.pendingSteps(fixed).length, 0);
}
{
  // A rejection by either co-approver ends it outright — there is nothing to agree.
  let r = mk("resignation", AGENT, { proposedValue: "2026-09-30" });
  r = W.decide(r, { approverId: "direct", actorId: "direct", decision: "reject", note: "Not accepted" }, { today: T }).request;
  eq("a co-approval rejection is terminal", W.statusOf(r), "rejected");
  eq("and leaves nothing actionable", W.pendingSteps(r).length, 0);
}
eq("approving a co-approval without proposing a value is refused",
  W.decide({ ...mk("resignation", AGENT), proposedValue: null },
    { approverId: "direct", actorId: "direct", decision: "approve" }, { today: T }),
  { ok: false, reason: "Propose a lastWorkingDay to agree on." });

console.log("\n── Deadlock broken by timeout ──");
{
  const stale = mk("resignation", AGENT, { proposedValue: "2026-09-30", raisedOn: ago(11) });
  eq("resolves after the window", W.autoResolve(stale, T).applies, true);
  // The requester's own proposal stands — deliberately not either approver's,
  // because letting one side's figure win on a timer makes deadlock a tactic.
  eq("the employee's proposal stands", W.autoResolve(stale, T).value, "2026-09-30");
  const resolved = W.autoResolve(stale, T).request;
  eq("status records that it was not a human decision", W.statusOf(resolved), "autoResolved");
  eq("every step is marked decided by the system",
    resolved.steps.every((s) => s.decidedBy === "system"), true);
  eq("with an explanation on the step",
    resolved.steps[0].note, "No agreement within 10 days — the proposed lastWorkingDay stands.");
}
eq("does not resolve before the window",
  W.autoResolve(mk("resignation", AGENT, { proposedValue: "2026-09-30", raisedOn: ago(9) }), T).applies, false);
eq("does not resolve on the boundary day minus one",
  W.autoResolve(mk("resignation", AGENT, { proposedValue: "x", raisedOn: ago(10) }), T).applies, true);
eq("nothing to stand on means no auto-resolution",
  W.autoResolve(mk("resignation", AGENT, { proposedValue: null, raisedOn: ago(30) }), T).applies, false);
eq("leave never auto-resolves",
  W.autoResolve(mk("leave", AGENT, { requestedUnits: 2, raisedOn: ago(90) }), T).applies, false);
eq("the resolution date is visible up front",
  W.autoResolveOn(mk("resignation", AGENT, { raisedOn: "2026-03-01" })), "2026-03-11");
eq("and is empty for types without a default",
  W.autoResolveOn(mk("leave", AGENT)), "");
{
  // An already-agreed request must not be re-resolved by the sweeper.
  let r = mk("resignation", AGENT, { proposedValue: "2026-09-30", raisedOn: ago(20) });
  r = W.decide(r, { approverId: "direct", actorId: "direct", decision: "approve", proposedValue: "2026-09-30" }, { today: T }).request;
  r = W.decide(r, { approverId: "dotted", actorId: "dotted", decision: "approve", proposedValue: "2026-09-30" }, { today: T }).request;
  eq("a settled request is left alone", W.autoResolve(r, T).applies, false);
}

console.log("\n── Delegation ──");
{
  const d = [{ approverId: "direct", delegateId: "deputy" }];
  eq("a standing delegation redirects", W.effectiveApprover("direct", d, T), "deputy");
  eq("others are unaffected", W.effectiveApprover("functional", d, T), "functional");
  eq("both may act", W.actingIdsFor("direct", d, T).sort(), ["deputy", "direct"]);
}
{
  const dated = [{ approverId: "direct", delegateId: "deputy", from: ago(5), to: ago(1) }];
  eq("an expired delegation does not apply", W.effectiveApprover("direct", dated, T), "direct");
  eq("but did apply inside its window", W.effectiveApprover("direct", dated, ago(3)), "deputy");
}
eq("a future delegation does not apply yet",
  W.effectiveApprover("direct", [{ approverId: "direct", delegateId: "deputy", from: addDays(T, 5) }], T), "direct");
eq("an open-ended delegation runs until revoked",
  W.effectiveApprover("direct", [{ approverId: "direct", delegateId: "deputy", from: ago(30) }], T), "deputy");
eq("a revoked delegation does not apply",
  W.effectiveApprover("direct", [{ approverId: "direct", delegateId: "deputy", revoked: true }], T), "direct");
eq("delegation chains hand on",
  W.effectiveApprover("a", [{ approverId: "a", delegateId: "b" }, { approverId: "b", delegateId: "c" }], T), "c");
// A mutual delegation is a data-entry mistake and must not hang a request.
eq("a mutual delegation terminates",
  W.effectiveApprover("a", [{ approverId: "a", delegateId: "b" }, { approverId: "b", delegateId: "a" }], T), "b");
{
  const r = mk("leave", AGENT, { requestedUnits: 2 });
  const d = [{ approverId: "functional", delegateId: "deputy" }];
  eq("the delegate may decide",
    W.decide(r, { approverId: "functional", actorId: "deputy", decision: "approve" }, { delegations: d, today: T }).ok, true);
  eq("the original approver still may too",
    W.decide(r, { approverId: "functional", actorId: "functional", decision: "approve" }, { delegations: d, today: T }).ok, true);
  eq("an uninvolved person may not",
    W.decide(r, { approverId: "functional", actorId: "outsider", decision: "approve" }, { delegations: d, today: T }),
    { ok: false, reason: "You are not the approver, and no delegation covers you." });
}

console.log("\n── Withdrawal ──");
eq("leave is withdrawable while pending",
  W.canWithdraw(mk("leave", AGENT, { requestedUnits: 2 }), "agent", T), { ok: true });
{
  let r = mk("leave", AGENT, { requestedUnits: 2 });
  r = W.decide(r, { approverId: "functional", actorId: "functional", decision: "reject" }, { today: T }).request;
  eq("but not once decided", W.canWithdraw(r, "agent", T),
    { ok: false, reason: "This request is already rejected." });
}
eq("only the requester may withdraw",
  W.canWithdraw(mk("leave", AGENT, { requestedUnits: 2 }), "someone-else", T),
  { ok: false, reason: "Only the person who raised this can withdraw it." });
eq("a resignation is withdrawable inside its window",
  W.canWithdraw(mk("resignation", AGENT, { raisedOn: ago(4) }), "agent", T), { ok: true });
eq("on the last day of the window",
  W.canWithdraw(mk("resignation", AGENT, { raisedOn: ago(10) }), "agent", T), { ok: true });
eq("after the window a manager must agree",
  W.canWithdraw(mk("resignation", AGENT, { raisedOn: ago(11) }), "agent", T),
  { ok: false, reason: "The 10-day window has passed — your manager must agree to withdraw this." });
eq("an already-withdrawn request cannot be withdrawn twice",
  W.canWithdraw({ ...mk("leave", AGENT), withdrawnAt: 1 }, "agent", T),
  { ok: false, reason: "Already withdrawn." });
eq("a type with no withdrawal route says so",
  W.canWithdraw(mk("payChange", AGENT), "agent", T),
  { ok: false, reason: "This request type cannot be withdrawn." });

console.log("\n── SLA and escalation ──");
{
  const fresh = mk("leave", AGENT, { requestedUnits: 2, raisedOn: T });
  eq("a fresh request has not breached", W.slaFor(fresh, T).breached, false);
  eq("and reports when it is due", W.slaFor(fresh, T).dueOn, addDays(T, 3));
  eq("naming who it waits on", W.slaFor(fresh, T).waitingOn, ["functional"]);
}
{
  const late = mk("leave", AGENT, { requestedUnits: 2, raisedOn: ago(6) });
  eq("an old request has breached", W.slaFor(late, T).breached, true);
  eq("by the right margin", W.slaFor(late, T).overdueBy, 3);
}
{
  /* The SLA clock restarts at each step. An approver who received a request
     yesterday has not breached because someone before them sat on it a week —
     their delay is theirs. */
  let r = mk("leave", AGENT, { requestedUnits: 2, raisedOn: ago(20) });
  const decidedAt = Date.now(); // the first approver acts today
  r = W.decide(r, { approverId: "functional", actorId: "functional", decision: "approve" }, { today: T, nowMs: decidedAt }).request;
  const sla = W.slaFor(r, T);
  eq("the second approver's clock starts at the handover", sla.waitedDays, 0);
  eq("so they have not breached", sla.breached, false);
  eq("and the SLA now names them", sla.waitingOn, ["direct"]);
}
eq("a settled request has no SLA",
  W.slaFor({ ...mk("leave", AGENT), withdrawnAt: 1 }, T), null);
{
  const rs = [
    mk("leave", AGENT, { requestedUnits: 1, raisedOn: ago(4) }),   // waited 4, SLA 3 → 1 over
    mk("leave", AGENT, { requestedUnits: 1, raisedOn: ago(30) }),  // waited 30, SLA 3 → 27 over
    mk("leave", AGENT, { requestedUnits: 1, raisedOn: T }),        // fine
  ];
  const esc = W.escalations(rs, T);
  eq("only breaches escalate", esc.length, 2);
  eq("worst first", esc.map((e) => e.sla.overdueBy), [27, 1]);
}

console.log("\n── Inbox ──");
{
  const a = mk("leave", AGENT, { requestedUnits: 2, raisedOn: ago(1) });
  const b = mk("leave", AGENT, { requestedUnits: 2, raisedOn: ago(9) });
  const settled = W.decide(mk("leave", AGENT, { requestedUnits: 2 }),
    { approverId: "functional", actorId: "functional", decision: "reject" }, { today: T }).request;

  const inbox = W.inboxFor("functional", [a, b, settled], { today: T });
  eq("only live requests appear", inbox.length, 2);
  eq("most overdue first", inbox[0].request.raisedOn, ago(9));
  eq("not flagged as delegated", inbox[0].viaDelegation, false);
  eq("the later approver's inbox is empty for now", W.inboxFor("direct", [a, b], { today: T }).length, 0);
}
{
  const r = mk("leave", AGENT, { requestedUnits: 2 });
  const d = [{ approverId: "functional", delegateId: "deputy" }];
  const inbox = W.inboxFor("deputy", [r], { delegations: d, today: T });
  eq("a delegate sees the work", inbox.length, 1);
  // So the UI can say "as X's delegate" rather than implying it is their own.
  eq("and it is flagged as delegated", inbox[0].viaDelegation, true);
  eq("the original approver still sees it too",
    W.inboxFor("functional", [r], { delegations: d, today: T }).length, 1);
}
{
  // Both co-approvers delegated to the same deputy: one entry, not two.
  const r = mk("resignation", AGENT, { proposedValue: "2026-09-30" });
  const d = [{ approverId: "direct", delegateId: "dep" }, { approverId: "dotted", delegateId: "dep" }];
  eq("one inbox entry per request", W.inboxFor("dep", [r], { delegations: d, today: T }).length, 1);
}

console.log("\n── Who may raise what ──");
eq("you may request your own leave",
  W.canRaise("leave", { actorId: "a", actorRole: "Agent", subjectId: "a" }), { ok: true });
eq("but not someone else's",
  W.canRaise("leave", { actorId: "a", actorRole: "Agent", subjectId: "b" }),
  { ok: false, reason: "You can only raise this for yourself." });
eq("HR may raise it on their behalf",
  W.canRaise("leave", { actorId: "hr", actorRole: "HRBusinessPartner", subjectId: "b" }), { ok: true });
eq("a manager may raise a termination for a report",
  W.canRaise("termination", { actorId: "m", actorRole: "OperationsLead", subjectId: "a", subordinateIds: ["a"] }),
  { ok: true });
eq("but not for someone else's report",
  W.canRaise("termination", { actorId: "m", actorRole: "OperationsLead", subjectId: "z", subordinateIds: ["a"] }),
  { ok: false, reason: "You can only raise this for someone who reports to you." });
eq("nor for themselves",
  W.canRaise("termination", { actorId: "m", actorRole: "OperationsLead", subjectId: "m" }),
  { ok: false, reason: "You cannot raise this about yourself." });
// Requiring a no-show to come from the manager means it goes unreported
// precisely when the manager is the one who has not noticed.
eq("anyone may report a no-show",
  W.canRaise("noShow", { actorId: "bystander", actorRole: "Agent", subjectId: "z" }), { ok: true });
eq("an unknown type may not be raised", W.canRaise("nonsense", { actorId: "a" }).ok, false);

console.log("\n── Consequences are declared ──");
eq("destructive types carry a consequence string",
  ["resignation", "termination", "noShow"].every((t) => (W.REQUEST_TYPES[t].consequence || "").length > 10), true);
eq("every type declares a chain rule",
  Object.values(W.REQUEST_TYPES).every((c) => typeof c.chain === "string"), true);
eq("every partial type declares its unit",
  Object.values(W.REQUEST_TYPES).filter((c) => c.partial).every((c) => !!c.unit), true);
eq("every co-approval type declares what is agreed and a default",
  Object.values(W.REQUEST_TYPES).filter((c) => c.chain === "coApproval")
    .every((c) => !!c.agreeOn && c.defaultAfterDays > 0), true);

console.log("\n── Payload validation ──");
/* The payload is the only free-form part of a request and it came from a
   browser. An unchecked value here becomes an unchecked value in a PDF. */
eq("a valid letter kind passes", W.checkPayload("letterRequest", { kind: "salary" }), { ok: true });
eq("every advertised kind is accepted",
  ["bank", "employment", "salary"].every((k) => W.checkPayload("letterRequest", { kind: k }).ok), true);
eq("an unknown kind is refused",
  W.checkPayload("letterRequest", { kind: "bonus" }),
  { ok: false, reason: '"kind" must be one of: bank, employment, salary.' });
eq("case matters — a near-miss is still a miss",
  W.checkPayload("letterRequest", { kind: "Salary" }).ok, false);
eq("so does stray whitespace", W.checkPayload("letterRequest", { kind: "salary " }).ok, false);
eq("a non-string is refused", W.checkPayload("letterRequest", { kind: 3 }).ok, false);
eq("an absent field is the type's own business, not a payload error",
  W.checkPayload("letterRequest", {}), { ok: true });
eq("unrelated keys are not policed here",
  W.checkPayload("letterRequest", { kind: "bank", note: "for my mortgage" }), { ok: true });

eq("leave types are enumerated too",
  W.checkPayload("leave", { leaveType: "Annual" }), { ok: true });
eq("an invented leave type is refused", W.checkPayload("leave", { leaveType: "Sabbatical" }).ok, false);

eq("a type with no enum accepts anything shaped like an object",
  W.checkPayload("transfer", { toDepartment: "Collections" }), { ok: true });
eq("an empty payload is fine", W.checkPayload("leave", {}), { ok: true });
eq("null is treated as empty", W.checkPayload("leave", null), { ok: true });
eq("undefined is treated as empty", W.checkPayload("leave", undefined), { ok: true });
eq("an unknown request type still gets the size and shape check",
  W.checkPayload("nonsense", { a: 1 }), { ok: true });

eq("an array is not a payload", W.checkPayload("leave", ["a"]).ok, false);
{
  const huge = { note: "x".repeat(W.MAX_PAYLOAD_BYTES + 1) };
  eq("an oversized payload is refused", W.checkPayload("leave", huge),
    { ok: false, reason: "The request details are too large." });
  const fine = { note: "x".repeat(100) };
  eq("an ordinary form payload is nowhere near the ceiling", W.checkPayload("leave", fine), { ok: true });
}
{
  const circular = { a: 1 };
  circular.self = circular;
  eq("a circular payload is refused, not thrown",
    W.checkPayload("leave", circular), { ok: false, reason: "The request details could not be read." });
}
eq("isPayloadChoice agrees with checkPayload",
  W.isPayloadChoice("letterRequest", "kind", "bank"), true);
eq("and rejects the same values", W.isPayloadChoice("letterRequest", "kind", "bonus"), false);
eq("an unknown field has no choices", W.isPayloadChoice("letterRequest", "colour", "red"), false);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

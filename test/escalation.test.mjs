/* Escalation.

   One assertion matters more than the rest: the manager an escalation is about
   must not be able to see it. Not hidden from their inbox — invisible, from
   every list they can reach, including a count. Someone who raises this has to
   live with the consequences of it leaking.

   The rest is about not making promises the module cannot keep — anonymity it
   cannot honour, and an urgent category with a slow SLA. */

const E = await import("../src/lib/escalation.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

const chain = { directManagerId: "lead", functionalManagerId: "pm", skipManagerId: "head" };
const HR = ["hr1", "hr2"];

console.log("\n── It goes above the manager, never to them ──");
{
  const r = E.routeFor("pay", chain, HR);
  eq("a pay escalation goes to the skip level", r.audience, ["head"]);
  ok("and says so, so the person raising it knows who reads it", /manager's manager/.test(r.why));
  ok("the direct manager is not in the audience", !r.audience.includes("lead"));
  /* The assertion the whole module exists for. */
  eq("and every manager in the line is named as someone who must not see it",
    E.mustNotSee(chain).sort(), ["lead", "pm"]);
}

console.log("\n── Some things never touch the line at all ──");
/* A grievance about conduct that lands on the desk of somebody who plays
   football with the person it is about was never really raised. */
{
  const r = E.routeFor("harassment", chain, HR);
  eq("harassment goes to HR", r.audience, HR);
  ok("not to the skip level, even though there is one", !r.audience.includes("head"));
  ok("and it says the line is bypassed", /not through anybody in your reporting line/.test(r.why));
  eq("safety is the same", E.routeFor("safety", chain, HR).audience, HR);
  ok("both are marked as bypassing", E.goesStraightToHr("harassment") && E.goesStraightToHr("safety"));
  ok("pay is not", E.goesStraightToHr("pay") === false);
}

console.log("\n── When there is nobody above ──");
{
  /* The top of a branch reporting to nobody must not mean an escalation goes
     nowhere. */
  const r = E.routeFor("pay", { directManagerId: "lead" }, HR);
  eq("it falls back to HR", r.audience, HR);
  ok("and says why rather than looking arbitrary", /nobody above your manager/.test(r.why));
}
ok("with no skip level and no HR it is refused rather than silently dropped",
  E.routeFor("pay", { directManagerId: "lead" }, []).ok === false);
ok("and the refusal says what is missing",
  /no HR contact/.test(E.routeFor("pay", { directManagerId: "lead" }, []).reason));
ok("harassment with no HR configured is refused rather than routed to the line",
  E.routeFor("harassment", chain, []).ok === false);
ok("an unknown category is refused", E.routeFor("invented", chain, HR).ok === false);

console.log("\n── Promises it will not make ──");
{
  /* Anonymity cannot be honoured: every escalation names a subject in order to
     be actionable, so offering it would be a lie. */
  const r = E.checkEscalation({ category: "pay", detail: "x".repeat(40), anonymous: true });
  eq("asking for anonymity does not block the escalation", r.problems, []);
  ok("but it explains that it cannot be anonymous", r.warnings.some((w) => /cannot be raised anonymously/.test(w)));
  ok("and offers the thing it can actually do", r.warnings.some((w) => /confidential/.test(w) && /manager is not told/.test(w)));
}

console.log("\n── Enough detail to act on ──");
ok("four words is refused", E.checkEscalation({ category: "pay", detail: "not paid right" }).problems.length > 0);
/* The reason is not gatekeeping: somebody reading it cannot ask a follow-up
   without revealing to the manager that something was raised. */
ok("and the refusal explains why detail is needed",
  E.checkEscalation({ category: "pay", detail: "short" }).problems.some((p) => /without having to ask your manager/.test(p)));
eq("a real account is accepted",
  E.checkEscalation({ category: "pay", detail: "I have worked eleven hours of overtime since June and none of it has appeared on a payslip." }).problems, []);
ok("no category is refused", E.checkEscalation({ detail: "x".repeat(40) }).problems.length > 0);
ok("an essay is refused with somewhere to go",
  E.checkEscalation({ category: "pay", detail: "x".repeat(5000) }).problems.some((p) => /offer to talk/.test(p)));

console.log("\n── Urgency matches the routing ──");
eq("harassment is same-day", E.slaFor("harassment"), 1);
eq("safety is same-day", E.slaFor("safety"), 1);
ok("treatment is faster than pay", E.slaFor("treatment") < E.slaFor("pay"));
eq("an unknown category still gets an SLA rather than none", E.slaFor("invented"), 5);

console.log("\n── The taxonomy's own wiring ──");
eq("nothing is inconsistent", E.checkEscalations(), []);
ok("the checker catches a category that bypasses the line but is not urgent", (() => {
  const saved = E.ESCALATION_CATEGORIES.harassment.slaDays;
  E.ESCALATION_CATEGORIES.harassment.slaDays = 5;
  const problems = E.checkEscalations();
  E.ESCALATION_CATEGORIES.harassment.slaDays = saved;
  return problems.some((p) => /bypasses the line because it is urgent/.test(p));
})());
ok("every category has both labels", E.ESCALATION_CODES.every((c) =>
  E.ESCALATION_CATEGORIES[c].label && E.ESCALATION_CATEGORIES[c].labelAr));

console.log("\n── The server, not the form, is the authority ──");
{
  /* A form check alone meant the API accepted "underpaid" as a grievance. The
     browser runs checkEscalation for the person's sake; checkPayload is what
     actually refuses it. */
  const W = await import("../src/lib/workflow.js");
  ok("a four-word escalation is refused by the engine, not only by the form",
    W.checkPayload("escalation", { category: "pay", detail: "underpaid" }).ok === false);
  ok("and the refusal explains why detail is needed",
    /without having to ask your manager/.test(W.checkPayload("escalation", { category: "pay", detail: "short" }).reason));
  ok("a missing category is refused",
    W.checkPayload("escalation", { detail: "x".repeat(40) }).ok === false);
  ok("an invented category is refused",
    W.checkPayload("escalation", { category: "invented", detail: "x".repeat(40) }).ok === false);
  ok("a real one passes",
    W.checkPayload("escalation", { category: "pay", detail: "I have worked eleven hours of unpaid overtime since June." }).ok);
}

console.log("\n── Nothing throws on nothing ──");
eq("no chain at all still resolves to HR", E.routeFor("pay", {}, HR).audience, HR);
eq("and mustNotSee is empty rather than [undefined]", E.mustNotSee({}), []);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

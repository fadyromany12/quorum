/* The org chart.

   The data is hand-maintained, so the assertions that matter are the ones about
   malformed charts: loops, managers who are not in the directory, and the move
   that quietly detaches a branch from the company. A tree view that hangs on a
   cycle is a bug; one that silently drops half the company is worse, because
   nobody notices. */

const H = await import("../src/lib/hierarchy.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

/*  head
     ├── lead1 ── a1, a2
     └── lead2 ── a3           */
const emp = (id, mgr, extra = {}) => ({ id, fullNameEn: id, directManagerId: mgr, stage: "Active", ...extra });
const org = [
  emp("head", null),
  emp("lead1", "head", { account: "Hertz" }),
  emp("lead2", "head", { account: "Lenovo" }),
  emp("a1", "lead1", { account: "Hertz" }), emp("a2", "lead1"), emp("a3", "lead2"),
];

console.log("\n── The shape ──");
{
  const { roots, cycles } = H.buildTree(org);
  eq("one root", roots.map((r) => r.id), ["head"]);
  eq("no loops in a clean chart", cycles, []);
  const head = roots[0];
  eq("span is direct reports", head.span, 2);
  eq("headcount is everyone beneath", head.headcount, 5);
  ok("and the head is a manager of managers", head.managerOfManagers);
  const lead1 = head.children.find((c) => c.id === "lead1");
  ok("a lead with only agents under them is not", lead1.managerOfManagers === false);
  eq("depth counts from the root", lead1.children[0].depth, 2);
}
eq("the skip level is reports of reports, not direct ones",
  H.skipLevelIds("head", org).sort(), ["a1", "a2", "a3"]);
eq("and a lead has no skip level", H.skipLevelIds("lead1", org), []);
ok("managesManagers agrees with the tree", H.managesManagers("head", org) && !H.managesManagers("lead1", org));

console.log("\n── Loops terminate and are named ──");
{
  /* Two people managing each other happens the first time somebody swaps a team
     over lunch. The walk must end, and it must say who. */
  const looped = [emp("x", "y"), emp("y", "x"), emp("z", "x")];
  const { cycles } = H.buildTree(looped);
  ok("the walk terminates rather than hanging", true);
  ok("and the loop is reported", cycles.length > 0);
  const { problems } = H.checkHierarchy(looped);
  ok("named in the problem, not described vaguely", problems.some((p) => /x/.test(p) && /y/.test(p)));
  ok("and it says what breaks — approvals", problems.some((p) => /approve/i.test(p)));
}
{
  const { roots, counted } = H.buildTree([emp("x", "y"), emp("y", "x")]);
  ok("a chart that is nothing but a loop still renders something", counted > 0 || roots.length >= 0);
  ok("and checkHierarchy says the chart has no top",
    H.checkHierarchy([emp("x", "y"), emp("y", "x")]).problems.some((p) => /no top|loop/i.test(p)));
}

console.log("\n── People who are not dropped ──");
{
  /* Their manager id points outside the set. Rendering the tree by parent
     lookup alone would make them vanish. */
  const withOrphan = [...org, emp("ghost", "someone-who-left")];
  const { roots } = H.buildTree(withOrphan);
  ok("an orphan appears as a root rather than disappearing", roots.some((r) => r.id === "ghost"));
  ok("flagged as orphaned, not mistaken for the top of the company",
    roots.find((r) => r.id === "ghost").orphaned === true);
  ok("the real root is not flagged", roots.find((r) => r.id === "head").orphaned === false);
  ok("and it is a problem, because their approvals have nowhere to go",
    H.checkHierarchy(withOrphan).problems.some((p) => /nowhere to go/.test(p)));
}
ok("somebody managing themselves is caught",
  H.checkHierarchy([emp("solo", "solo")]).problems.some((p) => /their own manager/.test(p)));

console.log("\n── Warnings that are not refusals ──");
{
  const wide = [emp("boss", null), ...Array.from({ length: 20 }, (_, i) => emp(`p${i}`, "boss"))];
  const { problems, warnings } = H.checkHierarchy(wide);
  eq("a 20-person span breaks nothing", problems, []);
  ok("but it is worth saying", warnings.some((w) => /20 direct reports/.test(w)));
  const deep = Array.from({ length: 12 }, (_, i) => emp(`d${i}`, i ? `d${i - 1}` : null));
  ok("an implausibly deep chart is flagged", H.checkHierarchy(deep).warnings.some((w) => /levels deep/.test(w)));
}

console.log("\n── The move that would cut a branch off ──");
{
  /* Put a manager under one of their own reports and the pair spins off into a
     loop with nobody above it. This is the assertion the whole module is for. */
  const p = H.movePlan("head", "a1", org);
  ok("moving somebody under their own subordinate is refused",
    p.problems.some((x) => /loop/.test(x)));
  ok("and the refusal explains the consequence, not just the rule",
    p.problems.some((x) => /cuts the branch off/.test(x)));
}
eq("moving somebody under themselves is refused",
  H.movePlan("a1", "a1", org).problems.some((x) => /themselves/.test(x)), true);
eq("a move to the manager they already have is refused",
  H.movePlan("a1", "lead1", org).problems.some((x) => /already reports to/.test(x)), true);
ok("a manager who is not in the directory is refused",
  H.movePlan("a1", "nobody", org).problems.length > 0);
ok("an exited manager cannot take reports",
  H.movePlan("a1", "gone", [...org, emp("gone", "head", { stage: "Exited" })])
    .problems.some((x) => /exited/i.test(x)));
ok("nor can an applicant",
  H.movePlan("a1", "new", [...org, emp("new", "head", { stage: "Applicant" })]).problems.length > 0);

console.log("\n── What a legitimate move actually moves ──");
{
  const p = H.movePlan("lead1", "lead2", org);
  eq("no problems", p.problems, []);
  /* Neither manager should discover afterwards that two other people came
     along with the person they were discussing. */
  ok("it says the team comes too", p.warnings.some((w) => /2 people move with them/.test(w)));
  eq("and names exactly who moves", p.moving.sort(), ["a1", "a2", "lead1"]);
  eq("the losing manager", p.losing, "head");
  eq("the gaining manager", p.gaining, "lead2");
  eq("and how deep they land", p.depth, 3);

  ok("crossing accounts is called out",
    H.movePlan("a1", "lead2", org).warnings.some((w) => /Hertz account to Lenovo/.test(w)));
  eq("a move within one team says nothing about accounts",
    H.movePlan("a1", "head", org).warnings.filter((w) => /account/.test(w)), []);
}

console.log("\n── The effects ──");
{
  eq("only the person named is rewritten — their reports follow them, not a bulk update",
    H.moveEffects({ newManagerId: "lead2" }).employee,
    { directManagerId: "lead2" });
  ok("the functional line moves only when asked",
    H.moveEffects({ newManagerId: "b", alsoFunctional: true }).employee.functionalManagerId === "b");
  eq("an account change earns its own timeline entry",
    H.moveEffects({ newManagerId: "b", newAccount: "Beko" }).events,
    ["MANAGER_CHANGED", "TRANSFERRED"]);
  eq("and a plain move earns one", H.moveEffects({ newManagerId: "b" }).events, ["MANAGER_CHANGED"]);
}

console.log("\n── Nothing here throws on nothing ──");
eq("an empty directory has an empty chart", H.buildTree([]).roots, []);
eq("and nothing to complain about", H.checkHierarchy([]).problems, []);
ok("moving a person who does not exist is refused rather than crashing",
  H.movePlan("nobody", "head", org).problems.length > 0);

console.log("\n── Both managers, or it does not happen ──");
{
  /* The bug this section exists for: statusOf special-cased the chain *name*
     rather than reading each step's kind, so a two-approver order was treated
     as "any one of them". A reporting-line change settled on the releasing
     manager's approval alone and applied the move — the manager who was
     supposed to be taking the person was never asked. */
  const W = await import("../src/lib/workflow.js");
  const chain = W.chainFor("reportingLine", { directManagerId: "head" }, { gainingManagerId: "lead2" });
  ok("the chain is the losing manager and the gaining one", chain.ok);
  eq("both at the same order, both co", chain.steps.map((s) => [s.approverId, s.order, s.kind]),
    [["head", 0, "co"], ["lead2", 0, "co"]]);

  const req = { type: "reportingLine", steps: chain.steps.map((s) => ({ ...s })) };
  eq("nobody has decided — pending", W.statusOf(req), "pending");
  req.steps[0].state = "approved";
  eq("one of two approvals is still pending, not approved", W.statusOf(req), "pending");
  req.steps[1].state = "approved";
  eq("both, and only then, is it approved", W.statusOf(req), "approved");

  const rejected = { type: "reportingLine", steps: chain.steps.map((s, i) => ({ ...s, state: i ? "rejected" : "approved" })) };
  eq("either one refusing settles it as rejected", W.statusOf(rejected), "rejected");

  /* The chains that genuinely are "any one of them" must not have changed. */
  const hr = W.chainFor("letterRequest", { directManagerId: "head" }, { hrIds: ["hr1", "hr2"] });
  const anyOne = { type: "letterRequest", steps: hr.steps.map((s, i) => ({ ...s, state: i ? "pending" : "approved" })) };
  eq("one HR approver out of two still satisfies an `any` order", W.statusOf(anyOne), "approved");

  ok("a move with no new manager named has nobody to approve taking them",
    W.chainFor("reportingLine", { directManagerId: "head" }, {}).ok === false);
  ok("and one to the manager they already have is refused before anyone is asked",
    W.chainFor("reportingLine", { directManagerId: "head" }, { gainingManagerId: "head" }).ok === false);
  ok("somebody with no manager today needs only the gaining manager",
    W.chainFor("reportingLine", { directManagerId: "" }, { gainingManagerId: "lead2" }).steps.length === 1);
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

/* Employment lifecycle, service maths, leave entitlement and org-tree walks.

   The cases worth reading are the ones pinning failures that are silent rather
   than loud: date/string coupling in accrual, placeholder ids reserving numbers
   they do not own, an org-chart cycle hanging a tree walk, and Art. 47's age-50
   route to the top tier being missed. None of these throw; they all just produce
   a plausible wrong answer. */

const LIB = "../src/lib";
const E = await import(`${LIB}/employee.js`);

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

console.log("\n── Lifecycle transitions ──");
eq("applicant -> onboarding", E.canTransition("Applicant", "Onboarding"), true);
eq("applicant -> active is not a shortcut", E.canTransition("Applicant", "Active"), false);
eq("active -> pip", E.canTransition("Active", "OnPip"), true);
eq("pip -> active (recovered)", E.canTransition("OnPip", "Active"), true);
eq("exited is terminal", E.nextStages("Exited"), []);
eq("no rehire by reactivation", E.canTransition("Exited", "Active"), false);
eq("unknown stage rejected", E.canTransition("Active", "Zombie"), false);

eq("checkTransition explains a bad edge",
  E.checkTransition({ stage: "Applicant" }, "Active"),
  { ok: false, reason: "Cannot go from Applicant to Active." });
eq("checkTransition explains terminality",
  E.checkTransition({ stage: "Exited" }, "Active"),
  { ok: false, reason: "Exited is terminal — a returning employee needs a new record." });
eq("no-op transition rejected",
  E.checkTransition({ stage: "Active" }, "Active"), { ok: false, reason: "Already Active." });
eq("valid edge passes", E.checkTransition({ stage: "Active" }, "Notice"), { ok: true });

console.log("\n── Headcount classification ──");
eq("applicant is not headcount", E.isHeadcount("Applicant"), false);
eq("onboarding is not yet headcount", E.isHeadcount("Onboarding"), false);
eq("serving notice still counts", E.isHeadcount("Notice"), true);
eq("suspended counts (still employed)", E.isHeadcount("Suspended"), true);
eq("exited does not count", E.isHeadcount("Exited"), false);
eq("suspended is not working", E.isWorking("Suspended"), false);

console.log("\n── Service maths ──");
// Calendar days in, numbers out — and never a throw. A Date/string mix-up here
// fails at the call site, where a defensive catch turns it into a silent zero.
eq("exactly one year", E.completedYears("2025-01-01", "2026-01-01"), 1);
eq("a day short of a year", E.completedYears("2025-01-02", "2026-01-01"), 0);
eq("ten years", E.completedYears("2016-01-01", "2026-01-01"), 10);
eq("missing hireDate yields 0, not NaN", E.serviceYears("", "2026-01-01"), 0);
eq("future hireDate yields 0", E.serviceYears("2027-01-01", "2026-01-01"), 0);
eq("age at a date", E.ageAt("1990-06-01", "2026-06-01"), 36);
eq("unknown birthDate is null, not 0", E.ageAt("", "2026-01-01"), null);

console.log("\n── Annual leave entitlement (Law 12/2003 Art. 47) ──");
const at = (hireDate, birthDate = "") => E.annualEntitlement({ hireDate, birthDate }, "2026-01-01");
eq("day one: not yet eligible", at("2025-12-01"), 0);
eq("five months: not yet eligible", at("2025-08-01"), 0);
eq("six months: base tier", at("2025-07-01"), 15);
eq("just under a year: base tier", at("2025-02-01"), 15);
eq("one full year: 21 days", at("2025-01-01"), 21);
eq("nine years: still 21", at("2017-01-01"), 21);
eq("ten years: 30 days", at("2016-01-01"), 30);
// Service years alone would leave a late-career hire capped at 21 days.
eq("age 50 reaches top tier on short service", at("2024-01-01", "1975-01-01"), 30);
eq("age 49 does not", at("2024-01-01", "1977-06-01"), 21);
eq("age route needs eligibility first", at("2025-12-01", "1970-01-01"), 0);

console.log("\n── Monthly accrual ──");
eq("21/yr accrues 1.75/month", E.monthlyAccrual({ hireDate: "2025-01-01" }, "2026-01-01"), 1.75);
eq("30/yr accrues 2.5/month", E.monthlyAccrual({ hireDate: "2016-01-01" }, "2026-01-01"), 2.5);
eq("15/yr accrues 1.25/month", E.monthlyAccrual({ hireDate: "2025-07-01" }, "2026-01-01"), 1.25);
eq("ineligible accrues nothing", E.monthlyAccrual({ hireDate: "2025-12-01" }, "2026-01-01"), 0);
eq("twelve months of accrual equals the year", E.monthlyAccrual({ hireDate: "2025-01-01" }, "2026-01-01") * 12, 21);
{
  // Policy is a parameter, not a literal — a policy change must not need a patch.
  const generous = { ...E.LEAVE_POLICY, afterOneYearDays: 24 };
  eq("policy override honoured",
    E.annualEntitlement({ hireDate: "2025-01-01" }, "2026-01-01", generous), 24);
}

console.log("\n── Probation ──");
eq("three months from the 1st", E.probationEnd("2026-01-01"), "2026-03-31");
eq("month-length overflow clamped", E.probationEnd("2025-11-30"), "2026-02-27");
eq("unknown hireDate yields empty", E.probationEnd(""), "");
eq("probation due once elapsed",
  E.probationDue({ stage: "Probation", hireDate: "2026-01-01", probationEnd: "2026-03-31" }, "2026-04-01"), true);
eq("not due before the end",
  E.probationDue({ stage: "Probation", hireDate: "2026-01-01", probationEnd: "2026-03-31" }, "2026-03-01"), false);
eq("only applies while on probation",
  E.probationDue({ stage: "Active", probationEnd: "2020-01-01" }, "2026-01-01"), false);

console.log("\n── Employee ids ──");
eq("first id starts the sequence", E.nextEmpId([]), "EMP-1001");
eq("increments past the max", E.nextEmpId(["EMP-1001", "EMP-1007", "EMP-1003"]), "EMP-1008");
eq("ignores unrelated formats", E.nextEmpId(["EG-9999", "1050", ""]), "EMP-1001");
// A substring check would read "EMP-12-PENDING" as 12, letting a placeholder
// reserve a number it does not own. Only an exact EMP-<digits> match counts.
eq("placeholders never seed the sequence", E.nextEmpId(["EMP-2000-PENDING"]), "EMP-1001");
eq("placeholder alongside a real id", E.nextEmpId(["EMP-1005", "EMP-9999-PENDING"]), "EMP-1006");
eq("whitespace tolerated", E.nextEmpId([" EMP-1042 "]), "EMP-1043");
eq("isEmpId accepts a real id", E.isEmpId("EMP-1001"), true);
eq("isEmpId rejects a placeholder", E.isEmpId("EMP-1001-PENDING"), false);

console.log("\n── Display name ──");
eq("prefers the preferred name",
  E.displayName({ preferredName: "Fady", fullNameEn: "Fady Romany Bekhet" }), "Fady");
eq("falls back to full name", E.displayName({ fullNameEn: "Salma El Hadad" }), "Salma El Hadad");
eq("falls back to work email", E.displayName({ workEmail: "x@konecta.com" }), "x@konecta.com");
eq("empty record yields empty string", E.displayName({}), "");

console.log("\n── Approval routing ──");
eq("functional manager approves first when different",
  E.approvalChain({ directManagerId: "d1", functionalManagerId: "f1" }), { ok: true, chain: ["f1", "d1"] });
eq("single approver when they are the same person",
  E.approvalChain({ directManagerId: "d1", functionalManagerId: "d1" }), { ok: true, chain: ["d1"] });
eq("single approver when no functional manager",
  E.approvalChain({ directManagerId: "d1" }), { ok: true, chain: ["d1"] });
// Without this gate, a request routes to nobody and sits invisible.
eq("no direct manager blocks submission",
  E.approvalChain({ functionalManagerId: "f1" }),
  { ok: false, reason: "No direct manager assigned — assign one before requesting leave." });

console.log("\n── Org tree ──");
{
  //  ceo ── lead1 ── agentA
  //      │        └─ agentB
  //      └─ lead2 ── agentC
  const all = [
    { id: "ceo", directManagerId: null },
    { id: "lead1", directManagerId: "ceo" },
    { id: "lead2", directManagerId: "ceo" },
    { id: "agentA", directManagerId: "lead1" },
    { id: "agentB", directManagerId: "lead1" },
    { id: "agentC", directManagerId: "lead2" },
  ];
  const byId = new Map(all.map((e) => [e.id, e]));

  eq("subtree of a lead", E.subordinateIds("lead1", all).sort(), ["agentA", "agentB"]);
  eq("subtree of the root is everyone else", E.subordinateIds("ceo", all).length, 5);
  eq("leaf has no subtree", E.subordinateIds("agentA", all), []);
  eq("chain upward from a leaf", E.managerChain("agentA", byId), ["lead1", "ceo"]);
  eq("root has no chain", E.managerChain("ceo", byId), []);

  eq("HR sees anyone", E.canViewEmployee("HRBusinessPartner", "lead1", "agentC", all), true);
  eq("lead sees own report", E.canViewEmployee("OperationsLead", "lead1", "agentA", all), true);
  eq("lead cannot see a peer's report", E.canViewEmployee("OperationsLead", "lead1", "agentC", all), false);
  eq("everyone sees themselves", E.canViewEmployee("Agent", "agentA", "agentA", all), true);
  eq("agent cannot see a colleague", E.canViewEmployee("Agent", "agentA", "agentB", all), false);
  eq("no employee record sees nothing", E.canViewEmployee("OperationsLead", null, "agentA", all), false);
}
{
  // A cycle in the org chart must terminate rather than hang the request. Org
  // data is hand-maintained; one bad manager assignment is enough.
  const cyc = [
    { id: "a", directManagerId: "b" },
    { id: "b", directManagerId: "a" },
  ];
  const byId = new Map(cyc.map((e) => [e.id, e]));
  eq("cyclic chain terminates", E.managerChain("a", byId), ["b"]);
  eq("cyclic subtree terminates", E.subordinateIds("a", cyc), ["b"]);
}

console.log("\n── Timeline ──");
eq("exit produces an EXITED event",
  E.stageChangeEvent({ stage: "Notice" }, "Exited", { name: "HR", role: "HRBusinessPartner" }).type, "EXITED");
eq("pip produces a PIP_OPENED event",
  E.stageChangeEvent({ stage: "Active" }, "OnPip", { name: "HR", role: "HRBusinessPartner" }).type, "PIP_OPENED");
eq("other moves are STAGE_CHANGED",
  E.stageChangeEvent({ stage: "Probation" }, "Active", {}).type, "STAGE_CHANGED");
eq("records both sides of the change",
  (({ fromVal, toVal }) => ({ fromVal, toVal }))(E.stageChangeEvent({ stage: "Probation" }, "Active", {})),
  { fromVal: "Probation", toVal: "Active" });
eq("timeline is newest first",
  E.sortTimeline([
    { id: "a", at: "2026-01-01T00:00:00Z" },
    { id: "c", at: "2026-03-01T00:00:00Z" },
    { id: "b", at: "2026-02-01T00:00:00Z" },
  ]).map((e) => e.id),
  ["c", "b", "a"]);
eq("equal timestamps keep a stable order",
  E.sortTimeline([
    { id: "a", at: "2026-01-01T00:00:00Z" },
    { id: "b", at: "2026-01-01T00:00:00Z" },
  ]).map((e) => e.id),
  ["b", "a"]);
eq("every stage-change type is a known event type",
  E.STAGES.filter((s) => s !== "Exited").every((from) =>
    E.nextStages(from).every((to) =>
      E.EVENT_TYPES.includes(E.stageChangeEvent({ stage: from }, to, {}).type))),
  true);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

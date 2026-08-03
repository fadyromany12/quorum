/* The role guide.

   One property matters above all the others: the guide must never promise a
   capability the API would refuse. A help page reads as authoritative, so a
   stale line is worse than no line — the person believes it, tries it, and gets
   a 403 they cannot explain.

   That property is guaranteed by derivation rather than by these tests, so what
   is tested here is the derivation's blind spot. An entry keyed on a permission
   that does not exist shows to nobody and fails silently; a screen id that was
   renamed does the same. checkGuide() is where those surface, and the negative
   assertions below pin the boundaries a reader would actually want to trust. */

const G = await import("../src/lib/guide.js");
const { ROLES, TABS_FOR, can } = await import("../src/lib/auth.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

const texts = (role) => G.guideFor(role).map((e) => e.what);
const mentions = (role, re) => texts(role).some((t) => re.test(t));

console.log("\n── The guide's own wiring ──");
eq("nothing is mis-keyed, orphaned or unreachable", G.checkGuide(), []);

console.log("\n── Every role gets a guide ──");
for (const r of ROLES) {
  ok(`${r} has something to read`, G.guideFor(r).length > 0);
  ok(`${r} has a stated purpose`, typeof G.ROLE_PURPOSE[r] === "string" && G.ROLE_PURPOSE[r].length > 20);
  ok(`${r} gets a heading naming the role`, G.guideTitle(r).startsWith("What you can do as "));
}

console.log("\n── It never promises what the role does not hold ──");
/* The whole point. Read the other way round from guideFor: for each role, no
   line may describe a screen that role cannot open. */
const SCREEN_WORDS = [
  [/discipline matrix/i, "matrix"],
  [/audit|immutable log/i, "audit"],
  [/case review|escalate, dismiss/i, "triage"],
  [/logins, set roles/i, "users"],
  [/lines of business/i, "settings"],
  [/waiting on you/i, "approvals"],
  [/adherence report/i, "rta"],
  [/sortable table/i, "roster"],
];
for (const r of ROLES) {
  const allowed = new Set(TABS_FOR[r] ?? []);
  for (const [re, tab] of SCREEN_WORDS) {
    if (allowed.has(tab)) continue;
    ok(`${r} is not told about ${tab}`, !mentions(r, re), `offending: ${texts(r).filter((t) => re.test(t)).join(" | ")}`);
  }
  if (!can({ role: r }, "piiRead")) {
    ok(`${r} is not told they can reveal identifiers`, !mentions(r, /reveal identifiers|bank details/i));
  }
  if (!can({ role: r }, "employeeWrite")) {
    ok(`${r} is not told they can admit people`, !mentions(r, /admit a new person/i));
  }
}

console.log("\n── Specific roles read the way the role actually works ──");
ok("an Operations Lead is told about approvals", mentions("OperationsLead", /waiting on you/i));
ok("an Operations Lead is not told about case review", !mentions("OperationsLead", /escalate, dismiss/i));
ok("a Project Manager is told they can log an event", mentions("ProjectManager", /log an attendance or conduct event/i));
ok("a Project Manager is not told they can approve", !mentions("ProjectManager", /waiting on you/i));
ok("WFM is told about the adherence import", mentions("WFM", /adherence report/i));
ok("WFM owns the plan as well as the floor", mentions("WFM", /queue needs hour by hour/i) && mentions("WFM", /demand forecast/i));
ok("WFM still sees far less than a Super Admin — theirs is a focused screen set",
  G.guideFor("WFM").length < G.guideFor("SuperAdmin").length / 2);
ok("and nothing about people they do not administer", !mentions("WFM", /directory|scorecard|audit/i));
ok("HR is told about both ends of the journey",
  mentions("HRBusinessPartner", /accepted offer/i) && mentions("HRBusinessPartner", /serving notice/i));
ok("a Super Admin sees the most of anyone",
  ROLES.every((r) => r === "SuperAdmin" || G.guideFor(r).length < G.guideFor("SuperAdmin").length));

console.log("\n── Agents ──");
const agent = texts("Agent");
ok("an agent is told about their own clock, leave, letters and signatures",
  [/clock in and out/i, /request leave/i, /letter/i, /sign/i].every((re) => agent.some((t) => re.test(t))));
ok("an agent, who has no workspace, is told about no workspace screen",
  !mentions("Agent", /audit|matrix|scorecard|directory|adherence/i));
eq("and their guide is grouped under the portal alone",
  G.groupedGuideFor("Agent").map((g) => g.group), ["Your portal"]);

console.log("\n── Grouping follows the sidebar, not the alphabet ──");
const sa = G.groupedGuideFor("SuperAdmin");
eq("a Super Admin's groups read in journey order",
  sa.map((g) => g.group),
  ["Overview", "Joining", "Working", "Growing", "Leaving", "Records", "Set up"]);
ok("every grouped item is one the flat guide also returns",
  sa.flatMap((g) => g.items).length === G.guideFor("SuperAdmin").length);
ok("no group is empty", sa.every((g) => g.items.length > 0));
eq("WFM sees only the sections they have screens in",
  G.groupedGuideFor("WFM").map((g) => g.group), ["Working"]);

console.log("\n── Dismissal is remembered per role and per version ──");
ok("the key names both", G.guideKey("Agent").includes("Agent") && G.guideKey("Agent").includes(`v${G.GUIDE_VERSION}`));
ok("two roles never share a key", G.guideKey("Agent") !== G.guideKey("SuperAdmin"));
ok("the version is a whole number", Number.isInteger(G.GUIDE_VERSION) && G.GUIDE_VERSION >= 1);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

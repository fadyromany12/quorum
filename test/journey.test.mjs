/* The journey spine.

   Structural, like the taxonomy: the failure mode is a phase claiming a stage
   the database does not have, a navigation section pointing at a screen nobody
   renders, or a role whose tabs land in no section at all and vanish from the
   sidebar. All three are silent in a browser until someone notices a missing
   menu entry. */

const J = await import("../src/lib/journey.js");
const E = await import("../src/lib/employee.js");
const A = await import("../src/lib/auth.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

console.log("\n── The phases ──");
eq("four phases, in the order employment runs", J.JOURNEY_IDS, ["join", "work", "grow", "leave"]);
eq("every phase has a label", J.JOURNEY.filter((p) => !p.label), []);
eq("every phase has an Arabic label", J.JOURNEY.filter((p) => !p.labelAr), []);
eq("every phase says what it covers", J.JOURNEY.filter((p) => !p.blurb), []);

console.log("\n── Phases cover the lifecycle exactly ──");
{
  const claimed = J.JOURNEY.flatMap((p) => p.stages);
  /* Every stage in exactly one phase. A stage in two makes a person appear on
     two screens at once; a stage in none makes them disappear from all of them. */
  eq("no stage is claimed twice", new Set(claimed).size, claimed.length);
  eq("every lifecycle stage belongs to a phase",
    E.STAGES.filter((s) => !claimed.includes(s)), []);
  eq("no phase claims a stage the database does not have",
    claimed.filter((s) => !E.STAGES.includes(s)), []);
}
eq("an applicant is joining", J.phaseOfStage("Applicant"), "join");
eq("probation is still joining", J.phaseOfStage("Probation"), "join");
eq("an active employee is working", J.phaseOfStage("Active"), "work");
eq("someone on a plan is growing", J.phaseOfStage("OnPip"), "grow");
eq("notice is leaving", J.phaseOfStage("Notice"), "leave");
eq("exited is leaving", J.phaseOfStage("Exited"), "leave");
eq("an unknown stage belongs nowhere, and says so", J.phaseOfStage("Nonsense"), null);

console.log("\n── Stage sets ──");
eq("joining spans offer to confirmation", J.stagesOf("join"), ["Applicant", "Onboarding", "Probation"]);
eq("leaving spans notice and beyond", J.stagesOf("leave"), ["Notice", "Exited"]);
eq("an unknown phase yields nothing, not everything", J.stagesOf("nope"), []);
/* Called twice, the same reference — People keys an effect on this and a fresh
   array each call would re-fire it forever. */
eq("repeated calls do not allocate a new array", J.stagesOf("join") === J.stagesOf("join"), true);

console.log("\n── Navigation ──");
{
  const placed = J.NAV_ORDER;
  eq("no screen is placed twice", new Set(placed).size, placed.length);
  eq("every section has at least one screen", J.NAV_SECTIONS.filter((s) => !s.tabs.length), []);
  eq("every section is labelled", J.NAV_SECTIONS.filter((s) => !s.label), []);

  /* The reframe's whole point: no role may hold a screen the navigation has no
     place for, or it silently disappears from their sidebar. */
  const everyRoleTab = [...new Set(Object.values(A.TABS_FOR).flat())];
  eq("every tab any role can reach has a home in the navigation",
    everyRoleTab.filter((t) => !placed.includes(t)), []);

  eq("the discipline matrix is configuration, not a daily screen",
    J.sectionOfTab("matrix").id, "setup");
  eq("the live floor is part of working", J.sectionOfTab("floor").id, "work");
  eq("case review sits under growing", J.sectionOfTab("triage").id, "grow");
  eq("an unplaced tab reports null rather than guessing", J.sectionOfTab("nope"), null);
}

console.log("\n── Building a role's navigation ──");
{
  const nav = J.navFor(A.TABS_FOR.SuperAdmin, { dashboard: { label: "Overview" } });
  eq("an admin sees every section", nav.length, J.NAV_SECTIONS.length);
  eq("metadata is merged onto the item", nav[0].items[0].label, "Overview");
  eq("the item keeps its id", nav[0].items[0].id, "dashboard");
  eq("nothing is lost", nav.flatMap((s) => s.items).length, A.TABS_FOR.SuperAdmin.length);
  eq("order follows the journey, not the role's list",
    nav.map((s) => s.id), ["overview", "join", "work", "grow", "leave", "records", "setup"]);
}
{
  /* WFM's screens all live in one phase. They should see one heading with
     their whole screen set under it, not seven headings with three entries
     scattered among five empty ones. */
  const nav = J.navFor(A.TABS_FOR.WFM);
  eq("empty sections are dropped", nav.length, 1);
  eq("WFM's screens sit under Working", nav[0].id, "work");
  /* Navigation order is the journey's, not the role's — the tab list happens to
     name planning first, and the sidebar still shows the floor before it. */
  eq("all of them are there, in the navigation's order",
    nav[0].items.map((i) => i.id), ["floor", "wfm", "rta"]);
}
{
  const nav = J.navFor(A.TABS_FOR.HRBusinessPartner);
  eq("HR owns both ends of the journey",
    [nav.some((s) => s.id === "join"), nav.some((s) => s.id === "leave")], [true, true]);
  eq("and does not get the setup screens", nav.some((s) => s.id === "setup"), false);
}
eq("an agent has no workspace navigation at all", J.navFor(A.TABS_FOR.Agent), []);
eq("an empty list yields no sections", J.navFor([]), []);
eq("an unknown tab is ignored rather than crashing", J.navFor(["invented"]), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

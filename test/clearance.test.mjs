/* Exit clearance — the sequence and its gate.

   The cases worth reading are the ordering ones. A checklist whose point is an
   order must not render in whatever order the database returns, and the "*"
   dependency has to mean "everything else", not "the step before me" — an exit
   that closes with a laptop still out is the failure this file exists to
   prevent. */

const C = await import("../src/lib/clearance.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

/** Build a step list from the default template, marking some keys done. */
const steps = (...doneKeys) =>
  C.DEFAULT_CLEARANCE.map((s) => ({ ...s, state: doneKeys.includes(s.key) ? "done" : "open" }));

console.log("\n── The template ──");
eq("five steps", C.DEFAULT_CLEARANCE.length, 5);
eq("keys are unique", new Set(C.DEFAULT_CLEARANCE.map((s) => s.key)).size, 5);
eq("handover starts unblocked", C.DEFAULT_CLEARANCE[0].dependsOn, "");
eq("the seal depends on everything", C.DEFAULT_CLEARANCE.at(-1).dependsOn, "*");
eq("every dependency names a real step",
  C.DEFAULT_CLEARANCE.every((s) => !s.dependsOn || s.dependsOn === "*" ||
    C.DEFAULT_CLEARANCE.some((o) => o.key === s.dependsOn)), true);

console.log("\n── Ordering ──");
{
  // Alphabetical is the wrong axis: it puts the seal third.
  const alphabetical = [...C.DEFAULT_CLEARANCE].sort((a, b) => a.key.localeCompare(b.key));
  eq("sorting by key misplaces the seal", alphabetical[2].key, "handover");
  const sorted = [...alphabetical].sort(C.byStepOrder);
  eq("byStepOrder restores the sequence",
    sorted.map((s) => s.key),
    ["handover", "it-assets", "facilities", "finance", "hr-final"]);
  eq("the seal is last", sorted.at(-1).key, "hr-final");
}
{
  const shuffled = [...C.DEFAULT_CLEARANCE].reverse().sort(C.byStepOrder);
  eq("any input order gives the same output", shuffled.map((s) => s.key),
    C.DEFAULT_CLEARANCE.map((s) => s.key));
}
{
  // A step in the table but not in the template must not displace the sequence.
  const withStray = [...C.DEFAULT_CLEARANCE, { key: "zz-custom", label: "Custom", dependsOn: "", state: "open" }];
  eq("an unknown key sorts last, not first", [...withStray].sort(C.byStepOrder).at(-1).key, "zz-custom");
  const two = [{ key: "b-unknown" }, { key: "a-unknown" }].sort(C.byStepOrder);
  eq("unknown keys break the tie by name", two.map((s) => s.key), ["a-unknown", "b-unknown"]);
}

console.log("\n── The gate ──");
eq("an unblocked step may be completed", C.canComplete(steps(), "handover"), { ok: true });
eq("a step with no dependency may be completed", C.canComplete(steps(), "finance"), { ok: true });
eq("a blocked step is refused",
  C.canComplete(steps(), "it-assets"),
  { ok: false, reason: "Work handover confirmed must be completed first." });
eq("the refusal names the blocker, not the key",
  C.canComplete(steps(), "facilities").reason.includes("Work handover confirmed"), true);
eq("completing the dependency unblocks it", C.canComplete(steps("handover"), "it-assets"), { ok: true });
eq("an already-done step is refused",
  C.canComplete(steps("handover"), "handover"), { ok: false, reason: "Already completed." });
eq("an unknown key is refused",
  C.canComplete(steps(), "nonsense"), { ok: false, reason: "No such clearance step." });
eq("an empty list refuses everything",
  C.canComplete([], "handover"), { ok: false, reason: "No such clearance step." });

console.log("\n── The seal waits for everything ──");
{
  const almost = steps("handover", "it-assets", "facilities");
  const r = C.canComplete(almost, "hr-final");
  eq("still blocked with one step open", r.ok, false);
  eq("and it says which one", r.reason, "Waiting on: Advances & dues settled.");
}
{
  const r = C.canComplete(steps("handover"), "hr-final");
  eq("lists every open step, not just the first", r.reason.split(",").length, 3);
}
eq("the seal opens once all others are done",
  C.canComplete(steps("handover", "it-assets", "facilities", "finance"), "hr-final"), { ok: true });
eq("the seal does not block on itself",
  C.canComplete(steps("handover", "it-assets", "facilities", "finance"), "hr-final").ok, true);

console.log("\n── Completion ──");
eq("an empty checklist is not complete", C.allDone([]), false);
eq("a partly done checklist is not complete", C.allDone(steps("handover")), false);
eq("one step short is not complete",
  C.allDone(steps("handover", "it-assets", "facilities", "finance")), false);
eq("all five done is complete",
  C.allDone(steps("handover", "it-assets", "facilities", "finance", "hr-final")), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

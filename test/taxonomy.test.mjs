/* The reason taxonomies.

   Most of these are structural: a taxonomy's failure mode is not a wrong
   calculation, it is drift — a reason pointing at an exit type that no longer
   exists, a dropdown whose options have no Arabic, a dependency naming a step
   that was renamed. Those are cheap to assert and expensive to find by hand.

   The two that carry real policy are casual leave deducting from the annual
   entitlement, and the attrition split. Both are the kind of thing that is
   wrong quietly for a year. */

const T = await import("../src/lib/taxonomy.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

const SETS = {
  LEAVE_TYPES: T.LEAVE_TYPES,
  EXIT_TYPES: T.EXIT_TYPES,
  EXIT_REASONS: T.EXIT_REASONS,
  ACTIVITY_STATES: T.ACTIVITY_STATES,
  LOGOUT_REASONS: T.LOGOUT_REASONS,
  TRAINING_TYPES: T.TRAINING_TYPES,
  MOVEMENT_REASONS: T.MOVEMENT_REASONS,
};

console.log("\n── Every set is well formed ──");
for (const [name, set] of Object.entries(SETS)) {
  const codes = Object.keys(set);
  eq(`${name}: has entries`, codes.length > 0, true);
  eq(`${name}: every entry has an English label`,
    codes.filter((c) => !set[c].label), []);
  eq(`${name}: every entry has an Arabic label`,
    codes.filter((c) => !set[c].labelAr), []);
  eq(`${name}: codes are identifiers, not prose`,
    codes.filter((c) => !/^[A-Za-z][A-Za-z0-9]*$/.test(c)), []);
  eq(`${name}: no duplicate English labels`,
    new Set(codes.map((c) => set[c].label)).size, codes.length);
}

console.log("\n── Leave ──");
eq("annual leave exists and is paid", T.LEAVE_TYPES.Annual.paid, true);
eq("unpaid leave is not paid", T.LEAVE_TYPES.Unpaid.paid, false);
/* The one people get wrong: Art. 51 casual leave comes *out of* the annual
   entitlement. Treating it as extra silently hands out six free days a year. */
eq("casual leave deducts from the annual entitlement", T.LEAVE_TYPES.Casual.deductsAnnual, true);
eq("and is capped at six days", T.LEAVE_TYPES.Casual.maxDaysPerYear, 6);
eq("and two consecutive", T.LEAVE_TYPES.Casual.maxConsecutive, 2);
eq("sick leave does not deduct from annual", T.LEAVE_TYPES.Sick.deductsAnnual, false);
eq("sick leave needs a document", T.LEAVE_TYPES.Sick.requiresEvidence, true);
eq("and says which one", T.LEAVE_TYPES.Sick.evidenceLabel, "Medical certificate");
eq("quarantine does not consume sick leave", T.LEAVE_TYPES.Quarantine.deductsAnnual, false);
eq("every evidenced leave names the evidence",
  T.evidencedLeaveCodes().filter((c) => !T.LEAVE_TYPES[c].evidenceLabel), []);
/* A statutory entitlement without its article is a policy nobody can check. */
eq("every statutory leave cites an article",
  T.LEAVE_CODES.filter((c) => T.LEAVE_TYPES[c].group === "Statutory" && !T.LEAVE_TYPES[c].statute), []);
/* Compelled absence is a separate group from entitlement: an employee chooses
   when to spend annual leave and has no say in a call-up. Only entitlements are
   a balance, and only entitlements can be refused. */
eq("directed absence is not filed as an entitlement",
  T.LEAVE_CODES.filter((c) => T.LEAVE_TYPES[c].group === "Directed"),
  ["Military", "CourtSummons", "Quarantine"]);
eq("no directed absence deducts from the annual balance",
  T.LEAVE_CODES.filter((c) => T.LEAVE_TYPES[c].group === "Directed" && T.LEAVE_TYPES[c].deductsAnnual), []);
eq("isLeaveType accepts a real code", T.isLeaveType("Annual"), true);
eq("and rejects an invented one", T.isLeaveType("Sabbatical"), false);
eq("the old free-text values are not codes", T.isLeaveType("Sick Leave"), false);

console.log("\n── Exits ──");
eq("the exit types match the database enum",
  T.EXIT_TYPE_CODES, ["Resignation", "Termination", "EndOfContract", "Retirement", "Abandonment"]);
eq("every reason points at a real exit type",
  T.EXIT_REASON_CODES.filter((c) => !T.EXIT_TYPES[T.EXIT_REASONS[c].exitType]), []);
eq("every exit type has at least one reason",
  T.EXIT_TYPE_CODES.filter((t) => T.exitReasonsFor(t).length === 0), []);
eq("resignation reasons are all voluntary",
  T.exitReasonsFor("Resignation").every((c) => T.isVoluntaryExit(c)), true);
eq("termination reasons are not",
  T.exitReasonsFor("Termination").some((c) => T.isVoluntaryExit(c)), false);
eq("dismissal for cause is not rehire-eligible", T.EXIT_REASONS.GrossMisconduct.rehireEligible, false);
/* Failing probation is a fit judgement, not a character one — someone wrong for
   a technical account may be right for a retention one two years later. */
eq("failing probation does not blacklist someone",
  T.EXIT_REASONS.ProbationNotConfirmed.rehireEligible, true);
eq("redundancy does not either", T.EXIT_REASONS.Redundancy.rehireEligible, true);
eq("conduct dismissals demand evidence",
  T.EXIT_REASON_CODES
    .filter((c) => T.EXIT_REASONS[c].category === "Conduct")
    .every((c) => T.EXIT_REASONS[c].requiresEvidence), true);

console.log("\n── Attrition classification ──");
eq("a resignation is voluntary", T.attritionClass("BetterOffer"), "voluntary");
eq("a dismissal is involuntary", T.attritionClass("GrossMisconduct"), "involuntary");
eq("end of contract is involuntary", T.attritionClass("FixedTermEnded"), "involuntary");
/* An unknown reason must not silently become "involuntary" — that is a number
   somebody reports to a board. */
eq("an unknown reason is unclassified, not guessed", T.attritionClass("Whatever"), "unclassified");
eq("and isVoluntaryExit says null rather than false", T.isVoluntaryExit("Whatever"), null);
eq("every reason classifies",
  T.EXIT_REASON_CODES.filter((c) => T.attritionClass(c) === "unclassified"), []);

console.log("\n── Activity states ──");
eq("the default state is a real one", T.isActivity("Available"), true);
eq("productive states", T.productiveCodes(),
  ["Available", "InCall", "AfterCallWork", "BackOffice", "Outbound"]);
eq("unpaid states", T.unpaidCodes(), ["Lunch", "Personal"]);
eq("states outside the agent's control are excused from adherence",
  T.excusedCodes(), ["Technical", "SystemOutage", "NoWorkAvailable"]);
/* Prayer happens several times a shift whether or not the tool has a code for
   it. Without one it lands in Break and eats the break allowance. */
eq("prayer is its own state", T.isActivity("Prayer"), true);
eq("and is paid", T.ACTIVITY_STATES.Prayer.paid, true);
eq("and does not come out of the break allowance",
  T.ACTIVITY_STATES.Prayer.maxPerShift, undefined);
eq("every limited state gives a limit in seconds",
  Object.keys(T.ACTIVITY_STATES)
    .filter((c) => T.ACTIVITY_STATES[c].maxPerShift && !T.ACTIVITY_STATES[c].limitSeconds), []);
eq("every state declares productive and paid",
  Object.keys(T.ACTIVITY_STATES).filter((c) =>
    typeof T.ACTIVITY_STATES[c].productive !== "boolean" ||
    typeof T.ACTIVITY_STATES[c].paid !== "boolean"), []);

console.log("\n── Logging out ──");
eq("an expected end of shift is agent-initiated", T.LOGOUT_REASONS.EndOfShift.agentInitiated, true);
eq("a system sweep is neither agent-initiated nor expected",
  [T.LOGOUT_REASONS.SystemSweep.agentInitiated, T.LOGOUT_REASONS.SystemSweep.expected], [false, false]);
eq("being sent home is expected but not the agent's doing",
  [T.LOGOUT_REASONS.SentHome.agentInitiated, T.LOGOUT_REASONS.SentHome.expected], [false, true]);

console.log("\n── Training ──");
eq("induction blocks live contacts", T.TRAINING_TYPES.Induction.blocksProduction, true);
eq("a refresher does not", T.TRAINING_TYPES.Refresher.blocksProduction, false);
/* Onboarding training both blocks live contacts and is compulsory. Cross-skilling
   also blocks — you cannot take contacts while learning another account — but it
   is opted into, so "blocks" and "mandatory" are genuinely different fields. */
eq("every onboarding course blocks live contacts",
  T.TRAINING_CODES.filter((c) => T.TRAINING_TYPES[c].group === "Onboarding" && !T.TRAINING_TYPES[c].blocksProduction), []);
eq("and every one of them is mandatory",
  T.TRAINING_CODES.filter((c) => T.TRAINING_TYPES[c].group === "Onboarding" && !T.TRAINING_TYPES[c].mandatory), []);
eq("blocking is not the same as mandatory",
  T.blockingTraining().filter((c) => !T.TRAINING_TYPES[c].mandatory), ["CrossSkill"]);
eq("compliance training expires", T.expiringTraining().includes("Compliance"), true);
eq("data protection training expires", T.expiringTraining().includes("DataProtection"), true);
eq("nothing expires without being mandatory",
  T.expiringTraining().filter((c) => !T.TRAINING_TYPES[c].mandatory), []);

console.log("\n── Onboarding checklist ──");
{
  const keys = T.ONBOARDING_STEPS.map((s) => s.key);
  eq("keys are unique", new Set(keys).size, keys.length);
  eq("the first step is unblocked", T.ONBOARDING_STEPS[0].dependsOn, "");
  eq("every dependency names a real step",
    T.ONBOARDING_STEPS.filter((s) => s.dependsOn && s.dependsOn !== "*" && !keys.includes(s.dependsOn)), []);
  eq("go-live waits on everything", T.ONBOARDING_STEPS.at(-1).dependsOn, "*");
  eq("and is the last step", T.ONBOARDING_STEPS.at(-1).key, "go-live");
  eq("every step has an owner", T.ONBOARDING_STEPS.filter((s) => !s.owner), []);
  eq("every step has an Arabic label", T.ONBOARDING_STEPS.filter((s) => !s.labelAr), []);
  /* Same shape as DEFAULT_CLEARANCE, so one gate can run both ends of the
     journey rather than two implementations drifting apart. */
  const C = await import("../src/lib/clearance.js");
  const shape = (s) => Object.keys(s).filter((k) => k !== "labelAr").sort();
  eq("it matches the clearance step shape",
    shape(T.ONBOARDING_STEPS[0]), shape(C.DEFAULT_CLEARANCE[0]));
}

console.log("\n── Movement ──");
eq("a promotion affects pay", T.MOVEMENT_REASONS.Promotion.affectsPay, true);
eq("an account transfer does not", T.MOVEMENT_REASONS.AccountTransfer.affectsPay, false);
eq("a demotion is not voluntary", T.MOVEMENT_REASONS.Demotion.voluntary, false);

console.log("\n── Lookup helpers ──");
eq("English label", T.labelOf(T.LEAVE_TYPES, "Annual", "en"), "Annual leave");
eq("Arabic label", T.labelOf(T.LEAVE_TYPES, "Annual", "ar"), "إجازة سنوية");
eq("defaults to English", T.labelOf(T.LEAVE_TYPES, "Annual"), "Annual leave");
eq("an unknown code falls back to itself, not to blank",
  T.labelOf(T.LEAVE_TYPES, "Nonsense", "ar"), "Nonsense");
eq("a null code does not crash", T.labelOf(T.LEAVE_TYPES, null), "");
eq("an undefined set does not crash", T.labelOf(undefined, "Annual"), "Annual");
{
  const opts = T.optionsOf(T.LEAVE_TYPES, "ar");
  eq("options cover every code", opts.length, T.LEAVE_CODES.length);
  eq("options carry value and label", Object.keys(opts[0]).sort(), ["group", "label", "value"]);
  eq("and are localised", opts.find((o) => o.value === "Sick").label, "إجازة مرضية");
}
{
  const groups = T.groupedOptions(T.LEAVE_TYPES);
  eq("grouping loses nothing",
    groups.reduce((n, g) => n + g.options.length, 0), T.LEAVE_CODES.length);
  eq("groups are named", groups.filter((g) => !g.group), []);
  eq("statutory leave is a group", groups.some((g) => g.group === "Statutory"), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

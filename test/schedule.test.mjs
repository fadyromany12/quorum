/* Rosters into coverage.

   The cases that matter are the ones a spreadsheet gets wrong: a shift that
   does not start on an interval boundary, breaks that have to come out of the
   middle, a night shift that crosses midnight, and scheduled training that
   occupies a person without covering the queue. Each of those, done naively,
   over-states coverage — which is the direction that leaves a queue unmanned. */

const S = await import("../src/lib/schedule.js");
const W = await import("../src/lib/wfm.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const near = (label, got, want, tol = 1e-9) =>
  ok(label, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

const shift = (startTime, durationMinutes, extra = {}) => ({
  employeeId: "e1", date: "2026-08-10", activity: "Shift",
  startTime, durationMinutes, paidBreakMinutes: 0, unpaidBreakMinutes: 0, ...extra,
});

console.log("\n── Clock times ──");
ok("09:30 is 570 minutes past midnight", S.minutesOf("09:30") === 570);
ok("00:00 is zero, not falsy-rejected", S.minutesOf("00:00") === 0);
ok("a 25th hour is not a time", Number.isNaN(S.minutesOf("25:00")));
ok("a 61st minute is not a time", Number.isNaN(S.minutesOf("09:61")));
ok("nonsense is not a time", Number.isNaN(S.minutesOf("half nine")));

console.log("\n── Which intervals a shift touches ──");
eq("a shift on the boundary fills whole intervals",
  S.intervalsCovered("09:00", 60, 30).map((i) => [i.interval, i.fraction]),
  [["09:00", 1], ["09:30", 1]]);
eq("a shift starting mid-interval only covers part of the first",
  S.intervalsCovered("09:10", 50, 30).map((i) => [i.interval, i.fraction]),
  [["09:00", 2 / 3], ["09:30", 1]]);
eq("and part of the last",
  S.intervalsCovered("09:00", 40, 30).map((i) => [i.interval, i.fraction]),
  [["09:00", 1], ["09:30", 1 / 3]]);
ok("a zero-length shift touches nothing", S.intervalsCovered("09:00", 0, 30).length === 0);
ok("an unparseable start touches nothing", S.intervalsCovered("", 480, 30).length === 0);

console.log("\n── Shifts that cross midnight ──");
const night = S.intervalsCovered("22:00", 540, 30); // 22:00 → 07:00
ok("a 22:00 nine-hour shift spans 18 half-hours", night.length === 18);
eq("it starts at 22:00", night[0].interval, "22:00");
eq("and ends in the small hours of the next day", night[night.length - 1].interval, "06:30");
ok("the intervals past midnight are marked as such",
  night.filter((i) => i.nextDay).length === 14 && night.slice(0, 4).every((i) => !i.nextDay));
ok("no interval is emitted twice despite the wrap",
  new Set(night.map((i) => i.interval)).size === night.length);

console.log("\n── Breaks come out of coverage ──");
const withBreaks = S.coverageOf(shift("09:00", 480, { paidBreakMinutes: 30, unpaidBreakMinutes: 30 }), 30);
near("an 8-hour shift with an hour of breaks covers 7 agent-hours",
  withBreaks.reduce((s, c) => s + c.agents, 0) / 2, 7);
ok("every interval is reduced, not one interval zeroed",
  withBreaks.every((c) => c.agents > 0 && c.agents < 1));
near("and each is reduced by the same 7/8", withBreaks[0].agents, 7 / 8);
ok("a shift whose breaks exceed it covers nothing rather than negative time",
  S.coverageOf(shift("09:00", 60, { paidBreakMinutes: 90 }), 30).every((c) => c.agents === 0));

console.log("\n── Only covering activities cover ──");
for (const a of ["Training", "Meeting", "Coaching", "Leave", "Off"]) {
  ok(`${a} contributes nothing to the queue`, S.coverageOf(shift("09:00", 480, { activity: a }), 30).length === 0);
}
ok("overtime does cover", S.coverageOf(shift("17:00", 120, { activity: "Overtime" }), 30).length === 4);
ok("an unknown activity covers nothing rather than defaulting to a shift",
  S.coverageOf(shift("09:00", 480, { activity: "Sabbatical" }), 30).length === 0);

console.log("\n── A roster becomes coverage per interval ──");
const roster = [
  shift("09:00", 480, { employeeId: "a", paidBreakMinutes: 30, unpaidBreakMinutes: 30 }),
  shift("09:00", 480, { employeeId: "b", paidBreakMinutes: 30, unpaidBreakMinutes: 30 }),
  shift("13:00", 480, { employeeId: "c", paidBreakMinutes: 30, unpaidBreakMinutes: 30 }),
  shift("09:00", 480, { employeeId: "d", activity: "Training" }),
];
const cov = S.scheduledByInterval(roster, 30);
near("two on shift at 09:00, and the trainee is not counted", cov["09:00"], 2 * (7 / 8));
near("three overlap at 13:00", cov["13:00"], 3 * (7 / 8));
near("the early pair have gone home by 17:30, leaving one", cov["17:30"], 7 / 8);
ok("an interval nobody works is simply absent", cov["03:00"] === undefined);
ok("coverage is fractional rather than rounded away", cov["09:00"] % 1 !== 0);

console.log("\n── Coverage meets the requirement ──");
const plan = W.planDay([{ interval: "09:00", contacts: 60 }, { interval: "13:00", contacts: 60 }], { ahtSeconds: 240 });
const c = W.coverage(plan, cov);
ok("the two engines join on the interval label", c.rows.every((r) => Number.isFinite(r.scheduled)));
ok("and a short interval is reported as short", c.rows.some((r) => r.state === "under"));

console.log("\n── Payroll reads the same rows ──");
const pay = S.payableMinutes(shift("09:00", 480, { paidBreakMinutes: 30, unpaidBreakMinutes: 30 }));
ok("the unpaid meal is not paid", pay.paidMinutes === 450);
ok("the paid break is", pay.paidMinutes > 480 - 60);
ok("on-queue time excludes both", pay.onQueueMinutes === 420);
ok("a day off is not paid", S.payableMinutes(shift("", 0, { activity: "Off" })).paidMinutes === 0);
ok("leave is paid", S.payableMinutes(shift("09:00", 480, { activity: "Leave" })).paidMinutes === 480);
ok("overtime is flagged as premium", S.payableMinutes(shift("17:00", 120, { activity: "Overtime" })).premium === true);
ok("an ordinary shift is not", S.payableMinutes(shift("09:00", 480)).premium === false);

console.log("\n── Shrinkage falls out of the roster ──");
const inputs = S.shrinkageInputs(roster);
const sh = W.shrinkageFrom(inputs);
ok("training hours are counted as shrinkage", inputs.trainingHours === 8);
ok("break hours are counted too", inputs.breakHours === 1.5);
ok("the derived figure is a real fraction", sh.shrinkage > 0 && sh.shrinkage < 1);
ok("and it names what it is made of", sh.parts.map((p) => p.name).includes("Training"));
ok("a roster of nothing but days off has no shrinkage and no paid hours", (() => {
  const i = S.shrinkageInputs([shift("", 0, { activity: "Off" })]);
  return i.paidHours === 0 && W.shrinkageFrom(i).shrinkage === 0;
})());

console.log("\n── Patterns are copied, never referenced ──");
const pattern = { id: "p1", startTime: "08:00", durationMinutes: 540, paidBreakMinutes: 30, unpaidBreakMinutes: 60 };
const fromPattern = S.entryFromPattern(pattern, "e9", "2026-08-11");
ok("the entry carries its own hours", fromPattern.startTime === "08:00" && fromPattern.durationMinutes === 540);
ok("it remembers where they came from", fromPattern.patternId === "p1");
ok("and it is not published by accident", fromPattern.published === false);
ok("editing the pattern afterwards does not move the shift", (() => {
  pattern.startTime = "11:00";
  return fromPattern.startTime === "08:00";
})());

console.log("\n── A row is checked before it is published ──");
eq("a good row has no problems", S.checkEntry(shift("09:00", 480)), []);
ok("a row with no start time is rejected", S.checkEntry(shift("", 480)).some((p) => /clock time/.test(p)));
ok("a row with no length is rejected", S.checkEntry(shift("09:00", 0)).some((p) => /no length/.test(p)));
ok("hours pasted instead of minutes are caught", S.checkEntry(shift("09:00", 1080)).some((p) => /units are minutes/.test(p)));
ok("breaks longer than the shift are caught", S.checkEntry(shift("09:00", 60, { paidBreakMinutes: 90 })).some((p) => /longer than the shift/.test(p)));
ok("an unknown activity is caught", S.checkEntry(shift("09:00", 480, { activity: "Nap" })).some((p) => /not a scheduled activity/.test(p)));
ok("a bad date is caught", S.checkEntry(shift("09:00", 480, { date: "10/08/2026" })).some((p) => /calendar day/.test(p)));
eq("a day off needs no hours", S.checkEntry({ employeeId: "e1", date: "2026-08-10", activity: "Off" }), []);

console.log("\n── Clashes ──");
const clashing = [
  shift("09:00", 480, { employeeId: "a" }),
  shift("13:00", 480, { employeeId: "a" }),
];
ok("two overlapping shifts for one person clash", S.findClashes(clashing).length === 1);
ok("a split shift with a genuine gap does not", (() => {
  const split = [shift("06:00", 240, { employeeId: "b" }), shift("14:00", 240, { employeeId: "b" })];
  return S.findClashes(split).length === 0;
})());
ok("a shift touching the next one's start does not clash", (() => {
  const back = [shift("06:00", 240, { employeeId: "c" }), shift("10:00", 240, { employeeId: "c" })];
  return S.findClashes(back).length === 0;
})());
ok("two people at the same hours never clash with each other",
  S.findClashes([shift("09:00", 480, { employeeId: "x" }), shift("09:00", 480, { employeeId: "y" })]).length === 0);
ok("the same hours on different days do not clash",
  S.findClashes([shift("09:00", 480, { employeeId: "z" }), shift("09:00", 480, { employeeId: "z", date: "2026-08-11" })]).length === 0);
ok("a day off cannot clash with a shift",
  S.findClashes([shift("09:00", 480, { employeeId: "w" }), { ...shift("09:00", 480, { employeeId: "w" }), activity: "Off" }]).length === 0);

console.log("\n── The activity list is internally consistent ──");
ok("every covering activity is also paid",
  S.coveringActivities().every((a) => S.SCHEDULE_ACTIVITIES[a].paid));
ok("nothing both covers the queue and counts as shrinkage",
  S.ACTIVITY_LIST.every((a) => !(S.SCHEDULE_ACTIVITIES[a].covers && S.SCHEDULE_ACTIVITIES[a].shrinkage)));
ok("every activity has a label in both languages",
  S.ACTIVITY_LIST.every((a) => S.SCHEDULE_ACTIVITIES[a].label && S.SCHEDULE_ACTIVITIES[a].labelAr));

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

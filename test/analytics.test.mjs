/* Workforce analytics.

   These are the numbers people take into budget meetings, so the tests are
   mostly about the ways a plausible-looking figure can be wrong:

     · a waterfall that does not reconcile and says nothing about it
     · an attrition rate measured against the wrong denominator
     · a leave liability that silently omits everyone with no salary on file
     · a month missing from a chart, which reads identically to a month of zero

   Each has a named assertion, because each has been shipped by somebody. */

const A = await import("../src/lib/analytics.js");
const C = await import("../src/lib/comp.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

const emp = (hireDate, exitDate = null, extra = {}) => ({ stage: exitDate ? "Exited" : "Active", hireDate, exitDate, ...extra });

console.log("\n── The waterfall reconciles, or says it does not ──");
{
  const people = [
    emp("2025-01-10"),                 // opened the window
    emp("2025-06-01"),                 // opened the window
    emp("2026-02-10"),                 // joined inside it
    emp("2026-03-01"),                 // joined inside it
    emp("2024-01-01", "2026-02-20"),   // left inside it
    emp("2023-01-01", "2025-12-01"),   // left before it
  ];
  const w = A.waterfall(people, "2026-01-01", "2026-03-31");
  eq("opening counts who had started and not yet left", w.opening, 3);
  eq("joiners are those hired inside the window", w.joiners, 2);
  eq("leavers are those who left inside it", w.leavers, 1);
  eq("closing is observed, not assumed", w.closing, 4);
  ok("and it reconciles", w.reconciles === true, `computed ${w.closingComputed}, observed ${w.closing}`);
  eq("net movement is stated", w.net, 1);
}
/* Reconciliation and data integrity are separate checks, and this case is why:
   someone hired in March and exited in January contributes +1 joiner and −1
   leaver, so the arithmetic identity holds perfectly while the record is
   nonsense. Asserting that reconciliation catches it would have been asserting
   something the maths cannot do. */
ok("an exit before a hire still reconciles arithmetically", (() => {
  const w = A.waterfall([emp("2026-03-01", "2026-01-15")], "2026-01-01", "2026-03-31");
  return w.reconciles === true;
})());
ok("but it is reported as an impossible record", (() => {
  const w = A.waterfall([emp("2026-03-01", "2026-01-15")], "2026-01-01", "2026-03-31");
  return w.impossible.length === 1;
})());
ok("and the figure is marked not worth quoting", (() => {
  const w = A.waterfall([emp("2026-03-01", "2026-01-15")], "2026-01-01", "2026-03-31");
  return w.trustworthy === false;
})());
ok("clean data is trustworthy on both counts", (() => {
  const w = A.waterfall([emp("2025-01-01"), emp("2024-01-01", "2026-02-01")], "2026-01-01", "2026-03-31");
  return w.trustworthy === true && w.impossible.length === 0;
})());
ok("an empty population reconciles trivially", A.waterfall([], "2026-01-01", "2026-03-31").trustworthy === true);
ok("someone hired after the window is not counted", (() => {
  const w = A.waterfall([emp("2026-09-01")], "2026-01-01", "2026-03-31");
  return w.joiners === 0 && w.closing === 0;
})());
ok("someone on notice is still headcount — they are still paid and still rostered", (() => {
  const w = A.waterfall([emp("2025-01-01", null, { stage: "Notice" })], "2026-01-01", "2026-03-31");
  return w.closing === 1;
})());

console.log("\n── Attrition is measured against average headcount ──");
{
  /* A team that doubles mid-window has a rate that looks half what it is if
     measured against closing, and double if measured against opening. */
  const w = { opening: 10, closing: 30, leavers: 4 };
  const r = A.attritionRate(w);
  ok("four leavers over an average of twenty is 20%", r === 20, `got ${r}`);
  ok("which is neither the opening nor the closing figure", r !== 40 && r !== Math.round((4 / 30) * 1000) / 10);
}
ok("an empty population has no rate, rather than a rate of zero",
  A.attritionRate({ opening: 0, closing: 0, leavers: 0 }) === null);
ok("nobody leaving is genuinely zero", A.attritionRate({ opening: 10, closing: 10, leavers: 0 }) === 0);

console.log("\n── Voluntary and involuntary are different problems ──");
{
  const people = [
    emp("2024-01-01", "2026-02-01", { exitReason: "Resignation" }),
    emp("2024-01-01", "2026-02-02", { exitReason: "Resignation" }),
    emp("2024-01-01", "2026-02-03", { exitReason: "Termination" }),
    emp("2024-01-01", "2026-02-04", { exitReason: "Mystery" }),
  ];
  const classify = (r) => (r === "Resignation" ? "voluntary" : r === "Termination" ? "involuntary" : "unclassified");
  const s = A.attritionSplit(people, "2026-01-01", "2026-03-31", classify);
  eq("the split is counted", [s.voluntary, s.involuntary, s.unclassified, s.total], [2, 1, 1, 4]);
  ok("an unknown reason is unclassified rather than assumed voluntary", s.unclassified === 1);
  ok("the parts sum to the total", s.voluntary + s.involuntary + s.unclassified === s.total);
}

console.log("\n── Leave liability is money, to the piastre ──");
{
  const rows = [
    { employeeId: "a", balanceDays: 10, monthlySalary: "9000.00" },   // 300/day → 3000
    { employeeId: "b", balanceDays: 5.5, monthlySalary: "6000.00" },  // 200/day → 1100
  ];
  const l = A.leaveLiability(rows);
  ok("each person is priced at their own daily rate", l.totalMinor === C.toMinor("4100.00"), `got ${l.total}`);
  ok("half days are carried", l.days === 15.5);
  ok("it is complete when everyone has a salary", l.complete === true && l.unpricedPeople === 0);
  ok("and it formats as money", l.display === "4,100.00");
}
ok("someone with no salary is counted, not costed at zero", (() => {
  const l = A.leaveLiability([
    { employeeId: "a", balanceDays: 10, monthlySalary: "9000.00" },
    { employeeId: "b", balanceDays: 10, monthlySalary: null },
  ]);
  return l.totalMinor === C.toMinor("3000.00") && l.unpricedPeople === 1 && l.complete === false;
})());
ok("and is named, so there is something to go and fix", (() => {
  const l = A.leaveLiability([{ employeeId: "missing-salary", balanceDays: 3, monthlySalary: null }]);
  return l.unpriced.includes("missing-salary");
})());
ok("their days still count toward the total days owed", (() => {
  const l = A.leaveLiability([{ employeeId: "b", balanceDays: 7, monthlySalary: null }]);
  return l.days === 7 && l.totalMinor === 0;
})());
ok("a negative balance is ignored rather than credited back", (() => {
  const l = A.leaveLiability([{ employeeId: "a", balanceDays: -4, monthlySalary: "9000.00" }]);
  return l.totalMinor === 0 && l.days === 0;
})());
ok("no rows is zero and complete", (() => {
  const l = A.leaveLiability([]);
  return l.totalMinor === 0 && l.complete === true;
})());

console.log("\n── Risk is signals, never a score ──");
{
  const r = A.flightRisk({
    hireDate: "2026-01-01",
    activeWarnings: 2,
    casesLast90: 4,
    leaveDaysTakenLast180: 0,
    monthsSincePayChange: 30,
  }, "2026-08-01");
  ok("every signal is named", r.signals.length >= 4);
  ok("each carries why it fired", r.signals.every((s) => s.detail && s.detail.length > 10));
  ok("the band is a word, not a probability", typeof r.band === "string" && !/\d/.test(r.band));
  ok("and there is no score to misread", r.score === undefined && r.probability === undefined);
  ok("the summary reads as a sentence", /signals:/.test(r.summary));
}
ok("a settled long-server with nothing wrong has no signals", (() => {
  const r = A.flightRisk({
    hireDate: "2019-01-01", activeWarnings: 0, casesLast90: 0,
    leaveDaysTakenLast180: 12, monthsSincePayChange: 6,
  }, "2026-08-01");
  return r.count === 0 && r.band === "none" && r.summary === "No signals.";
})());
ok("a brand-new joiner is not flagged in their first weeks", (() => {
  const r = A.flightRisk({ hireDate: "2026-07-20", leaveDaysTakenLast180: 0 }, "2026-08-01");
  return !r.signals.some((s) => s.code === "FIRST_YEAR");
})());
ok("no leave taken only counts once someone has been there long enough to take it", (() => {
  const r = A.flightRisk({ hireDate: "2026-06-01", leaveDaysTakenLast180: 0 }, "2026-08-01");
  return !r.signals.some((s) => s.code === "NO_LEAVE");
})());
ok("one signal is a watch, several are a conversation", (() => {
  const one = A.flightRisk({ hireDate: "2019-01-01", activeWarnings: 2, leaveDaysTakenLast180: 5 }, "2026-08-01");
  const many = A.flightRisk({ hireDate: "2026-01-01", activeWarnings: 2, casesLast90: 3, absenceDaysLast90: 6, monthsSincePayChange: 30, leaveDaysTakenLast180: 5 }, "2026-08-01");
  return one.band === "watch" && many.band === "urgent";
})());
ok("an unknown hire date does not invent a tenure signal",
  !A.flightRisk({ hireDate: "" }, "2026-08-01").signals.some((s) => s.code === "FIRST_YEAR"));

console.log("\n── Empty months are present, not missing ──");
{
  const rows = [{ date: "2026-01-15" }, { date: "2026-01-20" }, { date: "2026-04-02" }];
  const m = A.byMonth(rows, "2026-01", "2026-05");
  eq("every month in the range appears", m.map((x) => x.month), ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]);
  eq("with zero where nothing happened", m.map((x) => x.count), [2, 0, 0, 1, 0]);
}
ok("a window crossing a year boundary counts correctly", (() => {
  const m = A.byMonth([{ date: "2025-12-05" }, { date: "2026-01-05" }], "2025-11", "2026-02");
  return m.length === 4 && m[1].count === 1 && m[2].count === 1;
})());
ok("a row outside the window is not counted", (() => {
  const m = A.byMonth([{ date: "2020-01-01" }], "2026-01", "2026-02");
  return m.every((x) => x.count === 0);
})());
ok("a single-month window is one bucket", A.byMonth([], "2026-03", "2026-03").length === 1);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

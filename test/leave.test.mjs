/* The leave ledger.

   The cases worth reading are the calendar ones: the accrual schedule stepping
   up the month an employee crosses a tier boundary, the current month staying
   uncredited until it has finished happening, and an amount that disagrees with
   an old entry being reported for a human rather than silently rewritten. */

const L = await import("../src/lib/leave.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

console.log("\n── Month arithmetic ──");
eq("end of a 31-day month", L.monthEnd("2026-01"), "2026-01-31");
eq("end of February, common year", L.monthEnd("2026-02"), "2026-02-28");
eq("end of February, leap year", L.monthEnd("2028-02"), "2028-02-29");
eq("malformed key yields empty", L.monthEnd("junk"), "");
eq("next month", L.nextMonth("2026-01"), "2026-02");
eq("December rolls the year", L.nextMonth("2026-12"), "2027-01");

console.log("\n── Balance is a sum ──");
const E = (type, days, extra = {}) => ({ type, days, ...extra });
eq("empty ledger is zero", L.balanceOf([]), 0);
eq("credits and debits sum",
  L.balanceOf([E("accrual", 1.75), E("accrual", 1.75), E("grant", -3)]), 0.5);
eq("float dust is rounded once at the end",
  L.balanceOf([E("accrual", 0.1), E("accrual", 0.2)]), 0.3);
eq("junk rows are excluded, not fatal",
  L.balanceOf([E("accrual", 1.75), E("nonsense", 99), E("accrual", NaN)]), 1.75);
{
  const s = L.summarize([E("accrual", 1.75), E("accrual", 1.75), E("grant", -3), E("adjustment", 0.5, { note: "x" })]);
  eq("summary balance", s.balance, 1);
  eq("credited side", s.credited, 4);
  eq("debited side", s.debited, 3);
  eq("grouped by type", s.byType, { accrual: 3.5, grant: -3, adjustment: 0.5 });
}

console.log("\n── Entry validation: the sign is part of the type ──");
eq("a positive accrual is fine", L.checkEntry(E("accrual", 1.75)), { ok: true, days: 1.75 });
// The entry that passes review and corrupts a year of balances.
eq("a negative accrual is refused",
  L.checkEntry(E("accrual", -1.75)), { ok: false, reason: "A accrual must be positive." });
eq("a positive grant is refused",
  L.checkEntry(E("grant", 3)), { ok: false, reason: "A grant must be negative." });
eq("zero days is refused", L.checkEntry(E("accrual", 0)).ok, false);
eq("an unknown type is refused", L.checkEntry(E("bonus", 5)).ok, false);
eq("an adjustment may go either way",
  [L.checkEntry(E("adjustment", 2, { note: "correction" })).ok,
   L.checkEntry(E("adjustment", -2, { note: "correction" })).ok], [true, true]);
eq("but must say why",
  L.checkEntry(E("adjustment", 2)), { ok: false, reason: "A adjustment needs a note saying why." });

console.log("\n── The accrual schedule ──");
{
  // Hired 10 Jan 2025, asked in mid-July 2026. Eligibility starts at six
  // months (Jul 2025); the one-year anniversary (Jan 2026) steps the rate.
  const emp = { hireDate: "2025-01-10" };
  const plan = L.accrualSchedule(emp, "2026-07-15");
  eq("nothing accrues before the six-month point",
    plan.some((p) => p.monthKey < "2025-07"), false);
  eq("first accruing month", plan[0].monthKey, "2025-07");
  eq("credited at that month's end", plan[0].effectiveDate, "2025-07-31");
  eq("at the base rate", plan[0].days, 1.25);
  // The month containing the anniversary evaluates entitlement at month end,
  // so January 2026 itself is already at the higher tier.
  eq("the anniversary month steps the rate",
    plan.find((p) => p.monthKey === "2026-01").days, 1.75);
  eq("December before it was still base rate",
    plan.find((p) => p.monthKey === "2025-12").days, 1.25);
  // July 2026 has not finished happening.
  eq("the current month is not credited", plan[plan.length - 1].monthKey, "2026-06");
  eq("the whole schedule sums as expected",
    L.balanceOf(plan.map((p) => ({ type: "accrual", days: p.days }))),
    6 * 1.25 + 6 * 1.75); // Jul–Dec 2025 base, Jan–Jun 2026 stepped
}
eq("asking on the 1st credits through last month",
  L.accrualSchedule({ hireDate: "2025-01-01" }, "2026-03-01").slice(-1)[0].monthKey, "2026-02");
eq("no hire date, no schedule", L.accrualSchedule({ hireDate: "" }, "2026-07-15"), []);
eq("hired too recently to be eligible, no rows",
  L.accrualSchedule({ hireDate: "2026-05-01" }, "2026-07-15"), []);
{
  // The age-50 route flows through to the monthly rate too.
  const senior = { hireDate: "2024-06-01", birthDate: "1974-01-15" };
  const plan = L.accrualSchedule(senior, "2026-07-15");
  eq("age-50 tier reaches the schedule", plan[plan.length - 1].days, 2.5);
}

console.log("\n── The sweeper's diff ──");
{
  const emp = { hireDate: "2025-01-10" };
  const plan = L.accrualSchedule(emp, "2026-07-15");
  eq("an empty ledger is missing everything",
    L.missingAccruals([], plan).missing.length, plan.length);
  const partial = plan.slice(0, 5).map((p) => ({ type: "accrual", monthKey: p.monthKey, days: p.days }));
  const diff = L.missingAccruals(partial, plan);
  eq("only the gap is missing", diff.missing.length, plan.length - 5);
  eq("nothing is disputed", diff.disputed.length, 0);
  eq("running the diff twice changes nothing",
    L.missingAccruals([...partial, ...diff.missing.map((p) => ({ type: "accrual", monthKey: p.monthKey, days: p.days }))], plan).missing.length,
    0);
}
{
  // An amount that disagrees with an old entry is a human's problem, not the
  // job's — the ledger is append-only and history does not get rewritten.
  const plan = [{ monthKey: "2025-07", days: 1.75, effectiveDate: "2025-07-31" }];
  const diff = L.missingAccruals([{ type: "accrual", monthKey: "2025-07", days: 1.25 }], plan);
  eq("a disagreeing amount is disputed, not overwritten", diff.disputed.length, 1);
  eq("with both figures reported",
    [diff.disputed[0].days, diff.disputed[0].ledgerDays], [1.75, 1.25]);
  eq("and it is not also missing", diff.missing.length, 0);
}

console.log("\n── Grant debits ──");
const REQ = (over = {}) => ({
  id: "r1", type: "leave", status: "partial", grantedUnits: 3,
  payload: { leaveType: "Annual", from: "2026-08-09" }, ...over,
});
{
  const d = L.grantDebit(REQ());
  eq("a settled grant debits the granted figure, negative", d.days, -3);
  eq("linked to its request", d.requestId, "r1");
  eq("dated to the leave, not the decision", d.effectiveDate, "2026-08-09");
  eq("says what kind of leave", d.note, "Annual leave");
}
// Days are spent when granted, not when asked for.
eq("a pending request owes nothing", L.grantDebit(REQ({ status: "pending" })), null);
eq("a rejected request owes nothing", L.grantDebit(REQ({ status: "rejected" })), null);
eq("a withdrawn request owes nothing", L.grantDebit(REQ({ status: "withdrawn" })), null);
eq("a full approval debits in full", L.grantDebit(REQ({ status: "approved", grantedUnits: 5 })).days, -5);
eq("a non-leave request owes nothing", L.grantDebit(REQ({ type: "overtime" })), null);
eq("zero granted owes nothing", L.grantDebit(REQ({ grantedUnits: 0 })), null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

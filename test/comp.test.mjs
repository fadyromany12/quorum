/* Compensation arithmetic.

   Most of these exist because the float version of the same code is plausible
   and wrong: `19.99 * 100` is not 1999, summing a paybill drifts, and a
   percentage against a zero base is Infinity rather than an error. Money stays
   an integer here, and the tests pin the boundaries where that matters. */

const C = await import("../src/lib/comp.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

console.log("\n── Parsing to minor units ──");
eq("whole pounds", C.toMinor("14500"), 1450000);
eq("with piastres", C.toMinor("14500.50"), 1450050);
eq("single decimal place", C.toMinor("14500.5"), 1450050);
eq("a number, not a string", C.toMinor(14500), 1450000);
eq("zero", C.toMinor("0"), 0);
eq("whitespace tolerated", C.toMinor("  14500  "), 1450000);
eq("negative (an overpayment recovery)", C.toMinor("-500.25"), -50025);
// The case a float multiply gets wrong: 19.99 * 100 === 1998.9999999999998.
eq("the classic float failure", C.toMinor("19.99"), 1999);
eq("and another", C.toMinor("0.29"), 29);
eq("and 8.30", C.toMinor("8.30"), 830);
// A third decimal is data-entry noise; truncating never pays someone more.
eq("third decimal truncates, never rounds up", C.toMinor("100.999"), 10099);
eq("empty is null, not zero", C.toMinor(""), null);
eq("null is null", C.toMinor(null), null);
eq("letters are null", C.toMinor("14500 EGP"), null);
eq("a bare dot is null", C.toMinor("."), null);
eq("comma-grouped input is refused, not misparsed", C.toMinor("14,500"), null);
eq("absurd magnitude refused rather than losing precision", C.toMinor("999999999999999999"), null);

console.log("\n── Formatting back ──");
eq("round trip whole", C.fromMinor(1450000), "14500.00");
eq("round trip with piastres", C.fromMinor(1450050), "14500.50");
eq("pads a single piastre", C.fromMinor(1450005), "14500.05");
eq("zero", C.fromMinor(0), "0.00");
eq("negative", C.fromMinor(-50025), "-500.25");
eq("non-numeric yields empty", C.fromMinor(NaN), "");
eq("grouped for display", C.formatMinor(1450050), "14,500.50");
eq("grouping a large paybill", C.formatMinor(123456789), "1,234,567.89");
eq("no group separator under a thousand", C.formatMinor(99999), "999.99");
eq("negative grouped", C.formatMinor(-123456789), "-1,234,567.89");
{
  // Round-tripping every value must be lossless — this is the whole point.
  const samples = ["0", "0.01", "0.1", "1", "19.99", "999.99", "1000", "14500.5", "123456.78"];
  eq("round trip is lossless for all samples",
    samples.every((s) => C.toMinor(C.fromMinor(C.toMinor(s))) === C.toMinor(s)), true);
}
{
  // Summing in minor units must be exact where floats would drift.
  const ten = Array.from({ length: 10 }, () => C.toMinor("0.1"));
  eq("ten times 0.10 is exactly 1.00", C.fromMinor(ten.reduce((a, b) => a + b, 0)), "1.00");
}

console.log("\n── Percentage change ──");
eq("a 20% rise", C.changePct(1000000, 1200000), 20);
eq("a 3.4% rise", C.changePct(1450000, 1500000), 3.4);
eq("a decrease is negative", C.changePct(1200000, 1000000), -16.7);
eq("no change is zero", C.changePct(1450000, 1450000), 0);
// Infinity is not an actionable number, and a first salary has no % change.
eq("from zero is null, not Infinity", C.changePct(0, 1450000), null);
eq("non-numeric is null", C.changePct(null, 1450000), null);

console.log("\n── Daily rate ──");
eq("14500 over 30 days", C.dailyRate(1450000), 48333);
eq("divisor is overridable", C.dailyRate(1450000, 22), 65909);
eq("zero divisor yields zero, not Infinity", C.dailyRate(1450000, 0), 0);
eq("non-numeric yields zero", C.dailyRate(NaN), 0);

console.log("\n── Arrears on a backdated correction ──");
{
  // Paid 14500, should have been 15200, for the whole of April.
  const a = C.arrears(1450000, 1520000, "2025-04-01", "2025-04-30");
  eq("both ends inclusive", a.days, 30);
  eq("underpaid", a.underpaid, true);
  eq("per-day shortfall", a.perDayMinor, C.dailyRate(1520000) - C.dailyRate(1450000));
  eq("total is per-day times days", a.totalMinor, a.perDayMinor * 30);
  eq("total reads as money", C.formatMinor(a.totalMinor), "700.20");
}
eq("a single day is one day, not zero", C.arrears(1000000, 1100000, "2025-04-01", "2025-04-01").days, 1);
eq("no shortfall when nothing changed", C.arrears(1450000, 1450000, "2025-04-01", "2025-04-30").underpaid, false);
eq("an overpayment is reported, not hidden", C.arrears(1520000, 1450000, "2025-04-01", "2025-04-30").underpaid, false);
eq("reversed dates are refused", C.arrears(1000000, 1100000, "2025-04-30", "2025-04-01"), null);
eq("malformed dates are refused", C.arrears(1000000, 1100000, "", "2025-04-30"), null);

console.log("\n── Salary bands ──");
{
  const band = { minMinor: 1000000, maxMinor: 2000000 };
  eq("at the floor", C.bandPosition(1000000, band), { state: "in", pctOfRange: 0 });
  eq("mid-band", C.bandPosition(1500000, band), { state: "in", pctOfRange: 50 });
  eq("at the ceiling", C.bandPosition(2000000, band), { state: "in", pctOfRange: 100 });
  // Out-of-band is visible, not forbidden — market premiums and grandfathered
  // salaries are legitimate, and hiding them defers the problem.
  eq("below the floor is flagged", C.bandPosition(900000, band).state, "below");
  eq("above the ceiling is flagged", C.bandPosition(2500000, band).state, "above");
  eq("no band is unknown, not in-band", C.bandPosition(1500000, null).state, "unknown");
  eq("a zero-width band is one valid point, not a divide by zero",
    C.bandPosition(1000000, { minMinor: 1000000, maxMinor: 1000000 }), { state: "in", pctOfRange: 100 });
}

console.log("\n── Pay change validation ──");
eq("a straightforward rise",
  C.checkPayChange({ baseSalary: "15200", reason: "Merit", currency: "EGP" }, { previousMinor: 1450000 }),
  { ok: true, minor: 1520000 });
eq("an unparseable amount",
  C.checkPayChange({ baseSalary: "lots", reason: "Merit" }),
  { ok: false, reason: "Enter an amount, e.g. 14500 or 14500.50." });
eq("zero is refused",
  C.checkPayChange({ baseSalary: "0", reason: "Merit" }).ok, false);
eq("a missing reason is refused",
  C.checkPayChange({ baseSalary: "15200" }).ok, false);
eq("an unknown reason is refused",
  C.checkPayChange({ baseSalary: "15200", reason: "Because" }).ok, false);
eq("a bad currency is refused",
  C.checkPayChange({ baseSalary: "15200", reason: "Merit", currency: "Egyptian" }).ok, false);
eq("currency defaults to EGP",
  C.checkPayChange({ baseSalary: "15200", reason: "Merit" }).ok, true);
// An unlabelled cut is far likelier to be a dropped digit than an intended one.
eq("an unlabelled decrease is refused",
  C.checkPayChange({ baseSalary: "1450", reason: "Merit" }, { previousMinor: 1450000 }),
  { ok: false, reason: "That is a decrease — record it as a Demotion, Adjustment or Correction." });
eq("a labelled decrease is allowed",
  C.checkPayChange({ baseSalary: "1200000", reason: "Demotion" }, { previousMinor: 145000000 }).ok, true);
eq("a correction may decrease",
  C.checkPayChange({ baseSalary: "14000", reason: "Correction" }, { previousMinor: 1450000 }).ok, true);
eq("the first ever salary has nothing to compare against",
  C.checkPayChange({ baseSalary: "12000", reason: "Hire" }, { previousMinor: null }).ok, true);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

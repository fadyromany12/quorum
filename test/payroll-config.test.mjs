/* Payroll rates.

   The distinction this file exists to hold is between a rate that is *absent*
   and a rate that is *zero*. A zero rate is a decision somebody made; an absent
   rate is a decision nobody has made yet, and a payslip printing "Income tax
   0.00" for the second case is claiming to have calculated something it never
   looked at. Everything below is about not losing that distinction — including
   when the stored value is corrupt, which must read as absent rather than as
   nothing to deduct. */

const PC = await import("../src/lib/payroll-config.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};

console.log("\n── Absent is not zero ──");
ok("nothing stored reads as unconfigured", PC.readPayroll(null).configured === false);
ok("an empty object reads as unconfigured", PC.readPayroll({}).configured === false);
ok("a string reads as unconfigured rather than crashing", PC.readPayroll("11%").configured === false);
ok("rates present but not marked configured are not used",
  PC.readPayroll({ socialInsuranceRate: 0.11, taxRate: 0.1 }).configured === false);
ok("an explicit zero, once configured, is honoured as a decision",
  (() => {
    const r = PC.readPayroll({ configured: true, socialInsuranceRate: 0, taxRate: 0 });
    return r.configured === true && r.taxRate === 0;
  })());

console.log("\n── Corrupt reads as absent, never as nothing to deduct ──");
ok("a negative rate is refused", PC.readPayroll({ configured: true, socialInsuranceRate: -0.1, taxRate: 0.1 }).configured === false);
ok("a rate above the sanity ceiling is refused",
  PC.readPayroll({ configured: true, socialInsuranceRate: 11, taxRate: 0.1 }).configured === false);
ok("NaN is refused", PC.readPayroll({ configured: true, socialInsuranceRate: "abc", taxRate: 0.1 }).configured === false);
ok("one bad rate discards both, rather than half-applying",
  PC.readPayroll({ configured: true, socialInsuranceRate: 0.11, taxRate: 99 }).socialInsuranceRate === 0);
ok("a note survives even when the rates do not, so the reason is not lost",
  PC.readPayroll({ configured: true, socialInsuranceRate: 99, taxRate: 0.1, note: "pending finance" }).note === "pending finance");

console.log("\n── Percentages in, rates out ──");
{
  const r = PC.checkPayroll({ socialInsurancePct: 11, taxPct: 10 });
  ok("11% becomes 0.11", r.ok && Math.abs(r.socialInsuranceRate - 0.11) < 1e-12);
  ok("10% becomes 0.10", r.ok && Math.abs(r.taxRate - 0.1) < 1e-12);
  ok("and it round-trips back to the field", PC.toPercent(r.socialInsuranceRate) === 11);
}
ok("a fractional percentage survives", (() => {
  const r = PC.checkPayroll({ socialInsurancePct: 11.5, taxPct: 2.25 });
  return r.ok && PC.toPercent(r.socialInsuranceRate) === 11.5 && PC.toPercent(r.taxRate) === 2.25;
})());

console.log("\n── The decimal-point trap ──");
/* Someone typing 0.11 meaning eleven per cent gets 0.11% — a hundredfold
   under-deduction that looks entirely plausible on a payslip. It cannot be
   caught, and is not pretended to be. The reverse — typing 11 in a field that
   wanted 0.11 — is catchable and is caught, which is why the field takes
   percentages: the uncatchable mistake is the one that produces a number
   nobody notices. */
ok("11 is read as eleven per cent, as the field asks", PC.checkPayroll({ socialInsurancePct: 11, taxPct: 0 }).socialInsuranceRate === 0.11);
ok("a rate over 60% is refused as a probable mistake", PC.checkPayroll({ socialInsurancePct: 110, taxPct: 10 }).ok === false);
ok("and says which mistake it suspects",
  /enter 11 for eleven per cent/.test(PC.checkPayroll({ socialInsurancePct: 110, taxPct: 10 }).reason));

console.log("\n── Refusals ──");
ok("a missing rate is refused", PC.checkPayroll({ taxPct: 10 }).ok === false);
ok("a negative rate is refused", PC.checkPayroll({ socialInsurancePct: -1, taxPct: 10 }).ok === false);
ok("nonsense is refused", PC.checkPayroll({ socialInsurancePct: "eleven", taxPct: 10 }).ok === false);
ok("nothing at all is refused", PC.checkPayroll(null).ok === false);
ok("every refusal carries a sentence", ["", null, { taxPct: 1 }, { socialInsurancePct: -1, taxPct: 1 }]
  .every((b) => { const r = PC.checkPayroll(b); return r.ok || r.reason.length > 10; }));
ok("zero is accepted — it is a decision, not an absence",
  PC.checkPayroll({ socialInsurancePct: 0, taxPct: 0 }).ok === true);

console.log("\n── What reaches the payslip ──");
{
  const PS = await import("../src/lib/payslip.js");
  const C = await import("../src/lib/comp.js");
  const SAL = C.toMinor("9000.00");

  const unset = PS.buildPayslip({ period: "2026-08", baseMonthlyMinor: SAL, statutory: PC.readPayroll(null) });
  ok("unconfigured rates produce no tax line", unset.deductions.length === 0);
  ok("and the payslip warns it is not final", unset.notes.some((n) => /not a final net figure/.test(n)));

  const set = PS.buildPayslip({
    period: "2026-08", baseMonthlyMinor: SAL,
    statutory: PC.readPayroll({ configured: true, socialInsuranceRate: 0.11, taxRate: 0.1 }),
  });
  ok("configured rates produce both lines", set.deductions.length === 2);
  ok("and no warning", set.notes.length === 0);
  ok("the slip still balances", set.balances === true);

  const corrupt = PS.buildPayslip({
    period: "2026-08", baseMonthlyMinor: SAL,
    statutory: PC.readPayroll({ configured: true, socialInsuranceRate: 42, taxRate: 0.1 }),
  });
  ok("a corrupt rate behaves exactly like an absent one",
    corrupt.deductions.length === 0 && corrupt.notes.some((n) => /not a final net figure/.test(n)));
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

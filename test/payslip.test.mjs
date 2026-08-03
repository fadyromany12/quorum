/* Payslips.

   Two properties matter more than any individual figure.

   The first is that it adds up: the net must equal the gross minus the sum of
   the deduction lines, exactly, in integer minor units. A payslip that is off
   by a piastre is a payslip an employee stops believing, and rounding a sum
   rather than summing rounded lines is how that happens.

   The second is that it refuses rather than guesses. An absent salary, an
   unconfigured tax rate and a negative net are all cases where producing a
   plausible-looking document is worse than producing none, because this is the
   document that ends up in a labour dispute. */

const PS = await import("../src/lib/payslip.js");
const C = await import("../src/lib/comp.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

const SALARY = C.toMinor("9000.00"); // 900 000 piastres
const ot = (date, startTime, minutes) => ({
  employeeId: "e1", date, activity: "Overtime", startTime,
  durationMinutes: minutes, paidBreakMinutes: 0, unpaidBreakMinutes: 0,
});

console.log("\n── Rates ──");
ok("a 9 000 salary is 300 a day on the 30-day convention", C.dailyRate(SALARY) === C.toMinor("300.00"));
ok("and 37.50 an hour over an 8-hour day", PS.hourlyRate(SALARY) === C.toMinor("37.50"));
ok("no salary means no rate rather than a crash", PS.hourlyRate(0) === 0 && PS.hourlyRate(null) === 0);

console.log("\n── Overtime bands ──");
eq("a morning block is day rate", PS.overtimeBand({ date: "2026-08-10", startTime: "09:00" }), "day");
eq("an evening block is night rate", PS.overtimeBand({ date: "2026-08-10", startTime: "20:00" }), "night");
eq("19:00 is already night", PS.overtimeBand({ date: "2026-08-10", startTime: "19:00" }), "night");
eq("18:59 is not", PS.overtimeBand({ date: "2026-08-10", startTime: "18:30" }), "day");
eq("a rest day beats the time of day",
  PS.overtimeBand({ date: "2026-08-14", startTime: "09:00" }, { restDays: ["2026-08-14"] }), "restDay");
eq("and so does a holiday, even at night",
  PS.overtimeBand({ date: "2026-08-15", startTime: "21:00" }, { holidays: ["2026-08-15"] }), "holiday");
ok("the statutory multipliers are Art. 85's",
  PS.OVERTIME_RATES.day.multiplier === 1.35 &&
  PS.OVERTIME_RATES.night.multiplier === 1.7 &&
  PS.OVERTIME_RATES.restDay.multiplier === 2 &&
  PS.OVERTIME_RATES.holiday.multiplier === 2);

console.log("\n── A plain month ──");
{
  const s = PS.buildPayslip({ period: "2026-08", baseMonthlyMinor: SALARY });
  ok("gross is the salary", s.grossMinor === SALARY);
  ok("nothing is deducted", s.totalDeductionsMinor === 0);
  ok("net equals gross", s.netMinor === SALARY);
  ok("it adds up", s.balances === true);
  ok("the basic line explains itself", /Monthly salary in force for 2026-08/.test(s.earnings[0].how));
  ok("amounts are strings as well as integers", s.gross === "9000.00" && s.netDisplay === "9,000.00");
  eq("and it passes its own check", PS.checkPayslip(s), []);
}

console.log("\n── Overtime is banded, not listed per shift ──");
{
  const s = PS.buildPayslip({
    period: "2026-08",
    baseMonthlyMinor: SALARY,
    roster: [ot("2026-08-10", "17:00", 120), ot("2026-08-11", "17:00", 120), ot("2026-08-12", "20:00", 120)],
  });
  const codes = s.earnings.map((e) => e.code);
  ok("two day blocks become one line", codes.filter((c) => c === "OT_DAY").length === 1);
  ok("the night block is its own line", codes.includes("OT_NIGHT"));
  const day = s.earnings.find((e) => e.code === "OT_DAY");
  ok("four day hours at 37.50 × 1.35 is 202.50", day.amountMinor === C.toMinor("202.50"), `got ${day.amount}`);
  const night = s.earnings.find((e) => e.code === "OT_NIGHT");
  ok("two night hours at 37.50 × 1.70 is 127.50", night.amountMinor === C.toMinor("127.50"), `got ${night.amount}`);
  ok("each line cites the article", /Art\. 85/.test(day.how) && /Art\. 85/.test(night.how));
  ok("gross is the sum of the lines exactly",
    s.grossMinor === s.earnings.reduce((t, e) => t + e.amountMinor, 0));
  ok("a rest-day block is paid at double", (() => {
    const r = PS.buildPayslip({
      period: "2026-08", baseMonthlyMinor: SALARY,
      roster: [ot("2026-08-14", "09:00", 120)], restDays: ["2026-08-14"],
    });
    return r.earnings.find((e) => e.code === "OT_RESTDAY").amountMinor === C.toMinor("150.00");
  })());
  ok("an ordinary shift is not overtime", (() => {
    const r = PS.buildPayslip({
      period: "2026-08", baseMonthlyMinor: SALARY,
      roster: [{ ...ot("2026-08-10", "09:00", 480), activity: "Shift" }],
    });
    return r.earnings.length === 1;
  })());
}

console.log("\n── Absence ──");
{
  const s = PS.buildPayslip({ period: "2026-08", baseMonthlyMinor: SALARY, unpaidDays: 3 });
  const d = s.deductions.find((x) => x.code === "UNPAID");
  ok("three unpaid days cost three daily rates", d.amountMinor === C.toMinor("900.00"));
  ok("the line says how it was derived", /3 days at 300.00/.test(d.how));
  ok("net is gross less the deduction", s.netMinor === SALARY - C.toMinor("900.00"));
  ok("and it still adds up", s.balances === true);
  ok("zero unpaid days produces no line",
    PS.buildPayslip({ period: "2026-08", baseMonthlyMinor: SALARY, unpaidDays: 0 }).deductions.length === 0);
}

console.log("\n── The Art. 60 cap holds at the last moment before payment ──");
{
  const s = PS.buildPayslip({ period: "2026-08", baseMonthlyMinor: SALARY, disciplinaryDeductionDays: 8 });
  const d = s.deductions.find((x) => x.code === "DISCIPLINE");
  ok("eight days raised become five deducted", d.days === 5);
  ok("costing five daily rates, not eight", d.amountMinor === C.toMinor("1500.00"));
  ok("the excess is named as carried over", d.carriedOver === 3);
  ok("the line explains the cap", /Art\. 60 caps a month at 5/.test(d.how));
  ok("and the payslip carries a note about it", s.notes.some((n) => /capped at 5 days/.test(n)));
  const under = PS.buildPayslip({ period: "2026-08", baseMonthlyMinor: SALARY, disciplinaryDeductionDays: 2 });
  ok("a month under the cap is not annotated", under.notes.every((n) => !/capped/.test(n)));
  ok("and nothing carries over", under.deductions[0].carriedOver === 0);
}

console.log("\n── Statutory deductions are supplied, never assumed ──");
{
  const off = PS.buildPayslip({ period: "2026-08", baseMonthlyMinor: SALARY });
  ok("with nothing configured, no tax line is printed",
    off.deductions.every((d) => d.code !== "TAX" && d.code !== "SOCIAL_INSURANCE"));
  ok("a zero is never shown as though it were computed",
    !off.deductions.some((d) => d.amountMinor === 0));
  ok("and the payslip says it is not a final net figure",
    off.statutoryConfigured === false && off.notes.some((n) => /not a final net figure/.test(n)));

  const on = PS.buildPayslip({
    period: "2026-08", baseMonthlyMinor: SALARY,
    statutory: { configured: true, socialInsuranceRate: 0.11, taxRate: 0.1 },
  });
  const si = on.deductions.find((d) => d.code === "SOCIAL_INSURANCE");
  const tax = on.deductions.find((d) => d.code === "TAX");
  ok("social insurance is a share of gross", si.amountMinor === Math.round(SALARY * 0.11));
  ok("tax is charged after social insurance, not on gross",
    tax.amountMinor === Math.round((SALARY - si.amountMinor) * 0.1));
  ok("and each states its rate and its base", /11% of 9,000.00 gross/.test(si.how) && /after social insurance/.test(tax.how));
  ok("configured payslips carry no warning note", on.notes.length === 0);
  ok("it still adds up with four deduction lines", on.balances === true);
}

console.log("\n── It adds up, exactly, under everything at once ──");
{
  const s = PS.buildPayslip({
    period: "2026-08",
    baseMonthlyMinor: C.toMinor("7333.33"),
    roster: [ot("2026-08-10", "17:00", 95), ot("2026-08-14", "21:00", 65), ot("2026-08-15", "08:00", 47)],
    restDays: ["2026-08-14"],
    holidays: ["2026-08-15"],
    unpaidDays: 1,
    disciplinaryDeductionDays: 2,
    allowances: [{ code: "TRANSPORT", label: "Transport allowance", amountMinor: C.toMinor("450.00") }],
    statutory: { configured: true, socialInsuranceRate: 0.11, taxRate: 0.1 },
  });
  ok("gross is exactly the sum of its lines",
    s.grossMinor === s.earnings.reduce((t, e) => t + e.amountMinor, 0));
  ok("deductions are exactly the sum of theirs",
    s.totalDeductionsMinor === s.deductions.reduce((t, d) => t + d.amountMinor, 0));
  ok("net is gross minus deductions to the piastre", s.netMinor === s.grossMinor - s.totalDeductionsMinor);
  ok("every amount is a whole number of piastres",
    [...s.earnings, ...s.deductions].every((l) => Number.isInteger(l.amountMinor)));
  ok("the displayed net matches the integer", s.net === C.fromMinor(s.netMinor));
  ok("it declares itself balanced", s.balances === true);
  eq("and it passes its check", PS.checkPayslip(s), []);
}

console.log("\n── It refuses rather than guesses ──");
ok("no salary on record is caught",
  PS.checkPayslip(PS.buildPayslip({ period: "2026-08", baseMonthlyMinor: 0 })).some((p) => /No salary is on record/.test(p)));
ok("a period that is not a month is caught",
  PS.checkPayslip(PS.buildPayslip({ period: "August", baseMonthlyMinor: SALARY })).some((p) => /not a calendar month/.test(p)));
/* 28 unpaid days plus a capped disciplinary is 33 days of deduction against a
   30-day month. Rare, but it happens — a long unauthorised absence that ends in
   a disciplinary — and it is exactly the case where paying a negative would be
   both illegal and catastrophic. */
ok("deductions exceeding pay are caught rather than paid as a negative", (() => {
  const s = PS.buildPayslip({
    period: "2026-08", baseMonthlyMinor: C.toMinor("500.00"),
    unpaidDays: 28, disciplinaryDeductionDays: 5,
  });
  return s.netMinor < 0 &&
    s.notes.some((n) => /must not be paid as a negative/.test(n)) &&
    PS.checkPayslip(s).some((p) => /Net pay is negative/.test(p));
})());
ok("a line with no derivation is caught", (() => {
  const s = PS.buildPayslip({ period: "2026-08", baseMonthlyMinor: SALARY });
  s.earnings[0].how = "";
  return PS.checkPayslip(s).some((p) => /no derivation/.test(p));
})());
ok("a tampered total is caught", (() => {
  const s = PS.buildPayslip({ period: "2026-08", baseMonthlyMinor: SALARY });
  s.netMinor = s.netMinor + 1;
  s.balances = s.grossMinor - s.totalDeductionsMinor === s.netMinor;
  return PS.checkPayslip(s).some((p) => /do not add up/.test(p));
})());
ok("nothing at all is caught", PS.checkPayslip(null).length === 1);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

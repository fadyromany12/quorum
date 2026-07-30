/* Field editability tiers.

   The case this file exists for: date of birth must be in the verified tier.
   Art. 47 makes age 50 an independent route to the 30-day leave tier, so a
   freely self-editable birth date is a self-service pay rise of nine days —
   the tier is decided by what a field controls, not how personal it feels. */

const P = await import("../src/lib/profile-policy.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

console.log("\n── The rule: entitlements and payment destinations are verified ──");
eq("date of birth is verified, not self", P.tierOf("birthDate"), "verified");
eq("IBAN is verified", P.tierOf("iban"), "verified");
eq("bank account is verified", P.tierOf("accountNumber"), "verified");
eq("social insurance number is verified", P.tierOf("socialInsuranceNo"), "verified");
eq("passport is verified", P.tierOf("passportNumber"), "verified");
eq("national id is verified", P.tierOf("nationalId"), "verified");

console.log("\n── Ordinary personal data stays immediate ──");
eq("mobile is self", P.tierOf("phone"), "self");
eq("address is self", P.tierOf("addressAr"), "self");
eq("emergency contact is self", P.tierOf("emergencyName"), "self");
// Filed-under name identifies rather than computes; a misspelling fix should
// not need a ticket.
eq("arabic name is self", P.tierOf("fullNameAr"), "self");

console.log("\n── Employment facts are HR's ──");
eq("job title is HR-held", P.tierOf("jobTitle"), "hrHeld");
eq("hire date is HR-held", P.tierOf("hireDate"), "hrHeld");
eq("salary-adjacent grade is HR-held", P.tierOf("grade"), "hrHeld");
eq("unknown fields have no tier", P.tierOf("salary"), null);
eq("every field declares a tier and an entity",
  Object.values(P.FIELD_POLICY).every((p) => P.TIERS.includes(p.tier) && ["employee", "pii"].includes(p.entity)),
  true);

console.log("\n── Partitioning an edit ──");
{
  const r = P.partitionEdit({ phone: "0100", iban: "EG12", jobTitle: "CEO", nonsense: "x" });
  eq("self fields pass through", r.self, ["phone"]);
  eq("verified fields are routed to a request", r.verified, ["iban"]);
  eq("HR-held fields are refused with the dispute route",
    r.refused.find((x) => x.field === "jobTitle").reason,
    "Job title is held by HR — dispute it rather than editing it.");
  // Silently dropping an unknown field makes the caller believe it saved.
  eq("unknown fields are refused, not ignored",
    r.refused.find((x) => x.field === "nonsense").reason, '"nonsense" is not an editable field.');
}
eq("an empty edit partitions to nothing",
  P.partitionEdit({}), { self: [], verified: [], refused: [] });

console.log("\n── Completeness ──");
{
  const full = {
    fullNameAr: "ليلى", phone: "0100", personalEmail: "x@y", birthDate: "1990-01-01", addressAr: "القاهرة",
  };
  const fullPii = {
    nationalId: "29001010101234", iban: "EG12", bankName: "CIB", socialInsuranceNo: "123",
    emergencyName: "A", emergencyPhone: "0101", maritalStatus: "Single",
  };
  const c = P.completeness(full, fullPii);
  eq("a complete record is 100%", c.pct, 100);
  eq("nothing missing", c.missing, []);
  eq("nothing blocked", c.blocked, false);
}
{
  const c = P.completeness({ fullNameAr: "" }, null);
  eq("an empty record is 0%", c.pct, 0);
  eq("payment-blocking fields are flagged as such",
    c.missing.find((m) => m.field === "iban").blocking, true);
  eq("with the reason attached",
    c.missing.find((m) => m.field === "iban").why, "salary transfers need a destination");
  eq("non-blocking gaps are listed but not blocking",
    c.missing.find((m) => m.field === "phone").blocking, false);
  eq("the record is payment-blocked", c.blocked, true);
  // The label travels with the field so the UI never shows a raw key.
  eq("missing fields carry display labels",
    c.missing.every((m) => m.label && m.label !== m.field), true);
}
{
  // Only non-blocking gaps: incomplete, but nothing is held.
  const emp = { fullNameAr: "ليلى" };
  const pii = { nationalId: "1", iban: "2", bankName: "3", socialInsuranceNo: "4", emergencyName: "A", emergencyPhone: "0", maritalStatus: "S" };
  const c = P.completeness(emp, pii);
  eq("missing only nice-to-haves does not block", c.blocked, false);
  eq("but the percentage still reflects it", c.pct < 100, true);
}
eq("whitespace does not count as filled",
  P.completeness({ fullNameAr: "   " }, null).missing.some((m) => m.field === "fullNameAr"), true);

console.log("\n── The change set a verified request applies ──");
{
  const cs = P.verifiedChangeSet({
    birthDate: "1990-05-01", iban: " EG9900 ", phone: "0100", jobTitle: "CEO", junk: "x",
  });
  eq("verified employee fields land on the employee", cs.employee, { birthDate: "1990-05-01" });
  eq("verified pii fields land on pii, trimmed", cs.pii, { iban: "EG9900" });
  // The payload travelled through the browser; nothing else survives.
  eq("self, HR-held and unknown fields are all discarded",
    Object.keys(cs.employee).length + Object.keys(cs.pii).length, 2);
}
eq("an empty payload applies nothing", P.verifiedChangeSet({}), { employee: {}, pii: {} });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

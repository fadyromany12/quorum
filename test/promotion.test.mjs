/* Promotion.

   One of the four things a promotion changes is a login role, which makes this
   a privilege escalation with a friendly name. So the assertions that matter
   most are about what it refuses to grant and what it refuses to imply — an
   escalation nobody typed is worse than a promotion that needed a second form.

   The rest is about not producing half a promotion: a title without the access,
   or access without the title, is the exact state this exists to prevent. */

const P = await import("../src/lib/promotion.js");
const { ROLES } = await import("../src/lib/auth.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

const base = { jobTitle: "Team Leader", effectiveFrom: "2026-04-01", reason: "Promotion" };

console.log("\n── What it will not grant ──");
/* The account that can reach the discipline matrix, every salary and the
   factory reset is not something a promotion form hands out. */
eq("SuperAdmin is not grantable by promotion", P.isGrantable("SuperAdmin"), false);
ok("and asking for it is refused with a reason",
  P.checkPromotion({ ...base, newRole: "SuperAdmin" }).problems.some((x) => /cannot be granted/.test(x)));
ok("an invented role is refused too",
  P.checkPromotion({ ...base, newRole: "Emperor" }).problems.length > 0);
ok("every grantable role is a role the app actually defines",
  P.GRANTABLE_ROLES.every((r) => ROLES.includes(r)),
  P.GRANTABLE_ROLES.filter((r) => !ROLES.includes(r)).join(", "));
ok("and every manager role is itself grantable",
  P.MANAGER_ROLES.every((r) => P.isGrantable(r)));

console.log("\n── What it will not imply ──");
/* A title containing "Lead" must not silently upgrade someone's access. */
{
  const r = P.checkPromotion({ ...base, currentRole: "Agent" });
  eq("a title that suggests a role does not by itself grant one", r.problems, []);
  ok("but it says so out loud rather than passing in silence",
    r.warnings.some((w) => /usually means OperationsLead/.test(w)));
}
eq("the suggestion is only a suggestion", P.suggestRole("Team Leader"), "OperationsLead");
eq("an ordinary title suggests nothing at all", P.suggestRole("Customer Service Agent"), null);
eq("and neither does an empty one", P.suggestRole(""), null);
ok("effects drop a role the list does not allow, even if it reaches the payload",
  P.promotionEffects({ jobTitle: "X", newRole: "SuperAdmin" }).role === null);

console.log("\n── Money moving the wrong way ──");
/* A decrease filed as a "Promotion" is the row that gets found in a tribunal. */
ok("a pay cut labelled a promotion is refused",
  P.checkPromotion({ ...base, currentSalaryMinor: 900000, newSalaryMinor: 800000 })
    .problems.some((x) => /decrease/i.test(x)));
eq("the same cut is fine when it is called a demotion",
  P.checkPromotion({ ...base, reason: "Demotion", currentSalaryMinor: 900000, newSalaryMinor: 800000 }).problems, []);
ok("an unchanged salary is worth mentioning but not refusing",
  P.checkPromotion({ ...base, currentSalaryMinor: 900000, newSalaryMinor: 900000 }).warnings.length > 0);
ok("a reason outside the pay taxonomy is refused",
  P.checkPromotion({ ...base, reason: "Because" }).problems.length > 0);

console.log("\n── Empty teams are flagged, not blocked ──");
{
  const r = P.checkPromotion({ ...base, newRole: "OperationsLead", reportCount: 0 });
  eq("promoting into a manager role with nobody reporting is allowed", r.problems, []);
  ok("and says the org chart will show an empty team",
    r.warnings.some((w) => /empty team/i.test(w)));
  eq("with reports assigned there is nothing to say",
    P.checkPromotion({ ...base, newRole: "OperationsLead", reportCount: 6 })
      .warnings.filter((w) => /empty team/i.test(w)), []);
}

console.log("\n── The basics it insists on ──");
ok("a promotion without a title is refused", P.checkPromotion({ ...base, jobTitle: "" }).problems.length > 0);
ok("and one without an effective date", P.checkPromotion({ ...base, effectiveFrom: "" }).problems.length > 0);
ok("a malformed date is not accepted as one", P.checkPromotion({ ...base, effectiveFrom: "April 1st" }).problems.length > 0);

console.log("\n── The four change sets ──");
{
  const e = P.promotionEffects({
    jobTitle: "Team Leader", grade: "B1", account: "Lenovo", directManagerId: "mgr-1",
    newRole: "OperationsLead", newSalary: "12000", effectiveFrom: "2026-04-01", reason: "Promotion",
  });
  eq("the job and org fields land together",
    e.employee, { jobTitle: "Team Leader", grade: "B1", account: "Lenovo", directManagerId: "mgr-1" });
  eq("the access change is separate and explicit", e.role, "OperationsLead");
  eq("the pay change carries its own effective date", e.compensation.effectiveFrom, "2026-04-01");
  /* One promotion, one coherent set of timeline entries — rather than whatever
     field-diffing happened to notice afterwards. */
  eq("and the timeline records every part of it",
    e.events, ["PROMOTED", "ROLE_CHANGED", "TRANSFERRED", "MANAGER_CHANGED", "PAY_CHANGED"]);

  const plain = P.promotionEffects({ jobTitle: "Senior Agent", effectiveFrom: "2026-04-01" });
  eq("a title-only promotion touches nothing else", [plain.role, plain.compensation], [null, null]);
  eq("and records only itself", plain.events, ["PROMOTED"]);
  eq("empty strings are not written over real values", P.promotionEffects({ jobTitle: "X", grade: "" }).employee, { jobTitle: "X" });
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

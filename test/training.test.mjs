/* Training records.

   The cases that carry weight are the ones about *derivation*: expiry computed
   on read rather than stored, and readiness failing closed. Both are the kind
   of thing that looks fine in a demo and is wrong in production six weeks later
   — the first when a cron does not run, the second on somebody's first day. */

const T = await import("../src/lib/training.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

const rec = (type, state = "completed", completedOn = "2026-01-15") =>
  ({ type, state, completedOn: state === "completed" ? completedOn : "" });
const TODAY = "2026-07-31";

console.log("\n── Expiry is a calculation, not a column ──");
eq("a 12-month course expires a year on", T.expiresOn("Compliance", "2026-01-15"), "2027-01-15");
eq("a 24-month one, two years on", T.expiresOn("HealthAndSafety", "2026-01-15"), "2028-01-15");
eq("a course with no validity period never expires", T.expiresOn("Refresher", "2026-01-15"), "");
eq("no completion date, no expiry", T.expiresOn("Compliance", ""), "");
eq("a malformed date does not produce a malformed expiry", T.expiresOn("Compliance", "not-a-date"), "");
/* Rolling a month forward from the 31st overflows into the next month in JS.
   A certificate earned on 31 August must lapse on 28 February, not 3 March. */
eq("month-end does not overflow", T.expiresOn("Security", "2025-08-31"), "2026-08-31");
eq("into a shorter month it clamps", T.expiresOn("HealthAndSafety", "2026-08-31"), "2028-08-31");
{
  // 12 months from 29 Feb in a leap year lands on a date that does not exist.
  const got = T.expiresOn("Compliance", "2028-02-29");
  eq("a leap day expiry stays inside February", got, "2029-02-28");
}

console.log("\n── Status is what is true today ──");
eq("a fresh completion is complete", T.statusOf(rec("Compliance", "completed", "2026-07-01"), TODAY), "completed");
eq("one past its date is expired", T.statusOf(rec("Compliance", "completed", "2025-01-15"), TODAY), "expired");
eq("one inside the warning window is expiring soon",
  T.statusOf(rec("Compliance", "completed", "2025-08-20"), TODAY), "expiringSoon");
eq("a never-expiring type stays complete forever",
  T.statusOf(rec("Refresher", "completed", "2019-01-01"), TODAY), "completed");
eq("planned is planned", T.statusOf(rec("Induction", "planned"), TODAY), "planned");
eq("failed is failed", T.statusOf(rec("Induction", "failed"), TODAY), "failed");
eq("an unknown state falls back to planned rather than throwing",
  T.statusOf({ type: "Induction", state: "nonsense" }, TODAY), "planned");
eq("a valid record counts", T.isValid(rec("Compliance", "completed", "2026-07-01"), TODAY), true);
eq("an expired one does not", T.isValid(rec("Compliance", "completed", "2024-01-01"), TODAY), false);
/* Expiring soon still counts as held — the certificate is valid until the day
   it lapses, and refusing early would take people off the floor for nothing. */
eq("expiring soon still counts as held",
  T.isValid(rec("Compliance", "completed", "2025-08-20"), TODAY), true);

console.log("\n── What is required of whom ──");
{
  const onAccount = T.requiredFor({ account: "Lenovo" });
  const noAccount = T.requiredFor({});
  eq("client certification is required on an account", onAccount.includes("Certification"), true);
  eq("and not required off one", noAccount.includes("Certification"), false);
  eq("compliance is required either way",
    [onAccount, noAccount].every((l) => l.includes("Compliance")), true);
  eq("optional courses are never required", onAccount.includes("SoftSkills"), false);
}

console.log("\n── Readiness fails closed ──");
/* The one that matters. Normal set logic says an empty set satisfies "every
   requirement met", which would clear every new joiner on their first day —
   precisely the people the check exists for. */
{
  const r = T.readiness([], { account: "Lenovo" }, TODAY);
  eq("someone with no training at all is not ready", r.ready, false);
  eq("and the reason names what is missing", /Not started/.test(r.reason), true);
}
{
  const full = ["Induction", "ProductInitial", "SystemsTraining", "Nesting", "Certification"]
    .map((t) => rec(t, "completed", "2026-07-01"));
  const r = T.readiness(full, { account: "Lenovo" }, TODAY);
  eq("all blocking courses held is ready", r.ready, true);
  eq("nothing missing", r.missing, []);
  eq("nothing lapsed", r.lapsed, []);
  eq("and it says so", r.reason, "Cleared for live contacts.");
}
{
  const partial = ["Induction", "ProductInitial"].map((t) => rec(t, "completed", "2026-07-01"));
  const r = T.readiness(partial, { account: "Lenovo" }, TODAY);
  eq("a half-trained joiner is not ready", r.ready, false);
  eq("and the gap is named", r.missing.includes("Nesting"), true);
}
{
  // Certification lapsed; everything else current.
  const recs = [
    ...["Induction", "ProductInitial", "SystemsTraining", "Nesting"].map((t) => rec(t, "completed", "2026-07-01")),
    rec("Certification", "completed", "2024-01-01"),
  ];
  const r = T.readiness(recs, { account: "Lenovo" }, TODAY);
  eq("a lapsed certification blocks", r.ready, false);
  eq("it is reported as lapsed, not missing", [r.lapsed, r.missing], [["Certification"], []]);
  eq("and the reason distinguishes the two", /Lapsed/.test(r.reason), true);
}
{
  /* A lapsed *refresher* must not block. What stops someone taking contacts is
     what the client or the law requires, not everything anyone ever booked. */
  const recs = [
    ...["Induction", "ProductInitial", "SystemsTraining", "Nesting", "Certification"]
      .map((t) => rec(t, "completed", "2026-07-01")),
    rec("SoftSkills", "completed", "2019-01-01"),
  ];
  eq("an old optional course does not block", T.readiness(recs, { account: "Lenovo" }, TODAY).ready, true);
}
{
  // Re-sat after a lapse: the later, valid record must win.
  const recs = [
    ...["Induction", "ProductInitial", "SystemsTraining", "Nesting"].map((t) => rec(t, "completed", "2026-07-01")),
    rec("Certification", "completed", "2023-01-01"),
    rec("Certification", "completed", "2026-06-01"),
  ];
  eq("a retake supersedes the lapsed attempt", T.readiness(recs, { account: "Lenovo" }, TODAY).ready, true);
}
{
  const recs = ["Induction", "ProductInitial", "SystemsTraining", "Nesting"].map((t) => rec(t, "completed", "2026-07-01"));
  eq("off an account, certification is not demanded", T.readiness(recs, {}, TODAY).ready, true);
}

console.log("\n── What needs attention ──");
{
  const recs = [
    { ...rec("Compliance", "completed", "2024-01-01"), employeeId: "a" },   // long expired
    { ...rec("Security", "completed", "2025-08-20"), employeeId: "b" },     // expiring soon
    { ...rec("DataProtection", "completed", "2026-07-01"), employeeId: "c" }, // fine
    { ...rec("SoftSkills", "planned"), employeeId: "d" },                   // not completed
  ];
  const list = T.attentionList(recs, TODAY);
  eq("only lapsed and lapsing appear", list.map((r) => r.type), ["Compliance", "Security"]);
  eq("worst first", list[0].status, "expired");
  eq("each carries its expiry date", !!list[0].expiresOn, true);
  eq("and whether it blocks the floor", list.map((r) => r.blocking), [false, false]);
  eq("an empty list is empty, not an error", T.attentionList([], TODAY), []);
  eq("junk rows are skipped rather than fatal",
    T.attentionList([{ type: "Invented", state: "completed", completedOn: "2020-01-01" }], TODAY), []);
}

console.log("\n── Writing a record ──");
eq("a planned course is fine", T.checkRecord({ type: "Induction", state: "planned" }, TODAY), { ok: true });
eq("a completed one with a date is fine",
  T.checkRecord({ type: "Induction", state: "completed", completedOn: "2026-07-01" }, TODAY), { ok: true });
eq("an unknown type is refused",
  T.checkRecord({ type: "Juggling", state: "planned" }, TODAY),
  { ok: false, reason: '"Juggling" is not a training type.' });
eq("an unknown state is refused", T.checkRecord({ type: "Induction", state: "maybe" }, TODAY).ok, false);
eq("completed without a date is refused",
  T.checkRecord({ type: "Induction", state: "completed" }, TODAY).ok, false);
eq("completed in the future is refused",
  T.checkRecord({ type: "Induction", state: "completed", completedOn: "2027-01-01" }, TODAY).ok, false);
/* The commonest way a record starts lying: a completion date on something that
   was never completed. Expiry is computed from that date. */
eq("a date on an uncompleted course is refused",
  T.checkRecord({ type: "Induction", state: "planned", completedOn: "2026-07-01" }, TODAY).ok, false);

console.log("\n── Summary ──");
{
  const recs = [
    rec("Induction", "completed", "2026-07-01"),
    rec("Compliance", "completed", "2024-01-01"),
    rec("SoftSkills", "planned"),
  ];
  const s = T.summarise(recs, { account: "Lenovo" }, TODAY);
  eq("counts every record", s.total, 3);
  eq("grouped by what is true today", s.byStatus, { completed: 1, expired: 1, planned: 1 });
  eq("carries the readiness verdict", s.readiness.ready, false);
  eq("and the attention list", s.attention.map((r) => r.type), ["Compliance"]);
  eq("an empty record set summarises rather than throwing", T.summarise([], {}, TODAY).total, 0);
  eq("null is tolerated", T.summarise(null, {}, TODAY).total, 0);
}

console.log("\n── Renewal planning ──");
eq("renewal comes due before expiry",
  T.renewalDue(rec("Compliance", "completed", "2026-01-15"), TODAY), "2026-12-01");
eq("a never-expiring course is never due again",
  T.renewalDue(rec("Refresher", "completed", "2026-01-15"), TODAY), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

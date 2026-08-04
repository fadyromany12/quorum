/* Documents.

   Every assertion here is a version of one distinction: a document nobody ever
   provided and a document that lapsed are different failures. They have
   different fixes, different legal exposure, and a completeness number that
   collapses them tells you neither.

   The other thing worth testing is that a renewal filed alongside the old copy
   does not report the file as expired, because that is how people actually
   file things. */

const D = await import("../src/lib/documents.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

const TODAY = "2026-08-04";
const doc = (kind, expiresOn, extra = {}) => ({ id: `${kind}-${expiresOn}`, kind, expiresOn, location: "drive://x", ...extra });

console.log("\n── Notice periods are per kind, not global ──");
/* A medical certificate is a morning at a clinic. A work permit is months. */
eq("a work permit warns four months out", D.noticeFor("workPermit"), 120);
eq("a medical certificate warns one month out", D.noticeFor("medicalCert"), 30);
eq("an unknown kind still gets some warning rather than none", D.noticeFor("invented"), 30);
{
  const ninetyOut = "2026-11-02";
  eq("a work permit 90 days out is already urgent",
    D.docStatus(doc("workPermit", ninetyOut), TODAY), "expiringSoon");
  eq("a medical certificate 90 days out is not news",
    D.docStatus(doc("medicalCert", ninetyOut), TODAY), "valid");
}

console.log("\n── The states ──");
eq("in the past is expired", D.docStatus(doc("nationalId", "2026-07-01"), TODAY), "expired");
eq("far out is valid", D.docStatus(doc("nationalId", "2030-01-01"), TODAY), "valid");
eq("a kind that does not expire never expires", D.docStatus(doc("educationCert", "2020-01-01"), TODAY), "noExpiry");
eq("and neither does one with no date", D.docStatus(doc("nationalId", ""), TODAY), "noExpiry");
eq("today is not yet expired", D.docStatus(doc("nationalId", TODAY), TODAY), "expiringSoon");
eq("days left goes negative once it has lapsed", D.daysLeft(doc("x", "2026-08-01"), TODAY), -3);
eq("and is null when there is no date", D.daysLeft(doc("x", ""), TODAY), null);

console.log("\n── Expired is not missing ──");
{
  /* The distinction the whole module turns on. */
  const state = D.fileState([doc("nationalId", "2026-07-01")], { today: TODAY, kinds: ["nationalId", "contract"] });
  eq("a lapsed document is expired, not missing", state.expired.map((d) => d.kind), ["nationalId"]);
  eq("and a never-provided one is missing, not expired", state.missing.map((d) => d.kind), ["contract"]);
  eq("neither counts toward completeness", state.pct, 0);
  ok("and the file is not complete", state.complete === false);
}
{
  const state = D.fileState([doc("nationalId", "2030-01-01"), doc("contract", "2030-01-01")],
    { today: TODAY, kinds: ["nationalId", "contract"] });
  eq("both held and current is 100%", state.pct, 100);
  ok("and complete", state.complete);
  eq("with nothing to chase", [state.missing.length, state.expired.length], [0, 0]);
}

console.log("\n── A renewal filed next to the old copy ──");
{
  /* People re-file renewals alongside the old one. An expired 2023 passport
     sitting behind a valid 2029 one must not report the file as expired. */
  const state = D.fileState(
    [doc("passport", "2023-01-01"), doc("passport", "2029-01-01")],
    { today: TODAY, kinds: ["passport"] },
  );
  eq("only the newest counts", state.expired.length, 0);
  eq("and the file is complete", state.pct, 100);
  eq("the newest is the one kept", state.newest.map((d) => d.expiresOn), ["2029-01-01"]);
}
{
  const state = D.fileState([doc("nationalId", "2030-01-01", { voided: true })], { today: TODAY, kinds: ["nationalId"] });
  eq("a voided document does not count as held", state.missing.map((d) => d.kind), ["nationalId"]);
}

console.log("\n── Things that lapse but are not statutory ──");
{
  /* A client-mandated training certificate is not something an inspector asks
     for, and it still pulls somebody off an account the day it lapses. */
  const state = D.fileState([doc("trainingCert", "2026-07-01")], { today: TODAY, kinds: ["nationalId"] });
  ok("a lapsed non-required document is still chased", state.expired.some((d) => d.kind === "trainingCert"));
  eq("but it does not change the required percentage", state.pct, 0);
  eq("and the missing statutory one is still named", state.missing.map((d) => d.kind), ["nationalId"]);
}

console.log("\n── Sorting puts the urgent first ──");
{
  const state = D.fileState(
    [doc("medicalCert", "2026-08-20"), doc("contract", "2026-08-10"), doc("workPermit", "2026-09-01")],
    { today: TODAY, kinds: [] },
  );
  eq("soonest to lapse comes first", state.expiring.map((d) => d.kind), ["contract", "medicalCert", "workPermit"]);
}

console.log("\n── Recording one ──");
const check = (p) => D.checkDocument(p, { today: TODAY });
ok("a document with no kind is refused", check({ location: "x" }).problems.length > 0);
ok("and one with nowhere to find it", check({ kind: "contract" }).problems.some((x) => /where the document is/.test(x)));
/* "Cabinet 3, folder B" is a real answer in a company that still has a cabinet,
   and refusing it would push people to paste a fake URL. */
eq("a paper location is accepted", check({ kind: "contract", location: "Cabinet 3, folder B", expiresOn: "2030-01-01" }).problems, []);
ok("a malformed expiry is refused", check({ kind: "contract", location: "x", expiresOn: "01/01/2030" }).problems.length > 0);
ok("expiring before it was issued is refused",
  check({ kind: "contract", location: "x", issuedOn: "2030-01-01", expiresOn: "2029-01-01" }).problems.some((x) => /before it was issued/.test(x)));
{
  const r = check({ kind: "workPermit", location: "x" });
  eq("a missing expiry on something that expires is not refused", r.problems, []);
  ok("but it is flagged, because it will never be chased", r.warnings.some((w) => /never be chased/.test(w)));
}
{
  /* Filing what you have while chasing the new one is legitimate. It must not
     look like compliance. */
  const r = check({ kind: "nationalId", location: "x", expiresOn: "2026-01-01" });
  eq("recording an already-expired document is allowed", r.problems, []);
  ok("and says it does not make the file complete", r.warnings.some((w) => /does not make the file complete/.test(w)));
}
ok("an expiry on something that does not expire is questioned",
  check({ kind: "educationCert", location: "x", expiresOn: "2030-01-01" }).warnings.some((w) => /issue date/.test(w)));

console.log("\n── The taxonomy itself ──");
ok("every kind has a label", D.DOC_CODES.every((k) => D.DOC_KINDS[k].label));
ok("and an Arabic one", D.DOC_CODES.every((k) => D.DOC_KINDS[k].labelAr));
ok("every expiring kind has a notice period", D.DOC_CODES.filter((k) => D.DOC_KINDS[k].expires).every((k) => D.DOC_KINDS[k].noticeDays > 0));
ok("nothing that does not expire carries a notice period",
  D.DOC_CODES.filter((k) => !D.DOC_KINDS[k].expires).every((k) => D.DOC_KINDS[k].noticeDays === 0));
ok("the required list is exactly the statutory kinds",
  D.REQUIRED_KINDS.every((k) => D.DOC_KINDS[k].statutory) && D.REQUIRED_KINDS.length > 0);
/* An ID scan is not directory data. */
ok("identity documents are sensitive", ["nationalId", "passport", "workPermit"].every(D.isSensitive));
ok("an offer letter is not", D.isSensitive("offerLetter") === false);

console.log("\n── One line for a list ──");
eq("a complete file says so", D.summarise(D.fileState([doc("nationalId", "2030-01-01")], { today: TODAY, kinds: ["nationalId"] })), "Complete");
eq("and a broken one counts each kind of problem separately",
  D.summarise(D.fileState([doc("nationalId", "2026-01-01")], { today: TODAY, kinds: ["nationalId", "contract"] })),
  "1 missing · 1 expired");

console.log("\n── Nothing throws on nothing ──");
eq("an empty file with no requirements is complete", D.fileState([], { today: TODAY, kinds: [] }).pct, 100);
ok("an empty file with requirements is not", D.fileState([], { today: TODAY }).complete === false);
eq("and summarise survives being handed nothing", D.summarise(null), "");

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

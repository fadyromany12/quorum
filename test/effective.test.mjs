/* Effective-dated records.

   The cases worth reading are the temporal ones: a backdated correction must
   change what the past looks like *now* without changing what the system
   believed *then*. Get that wrong and either arrears cannot be computed, or a
   payment that was correct on the day becomes indefensible in hindsight. */

const E = await import("../src/lib/effective.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

/* A three-step salary history, each version recorded on the day it took effect. */
const SALARY = [
  { id: "v1", effectiveFrom: "2024-01-01", recordedAt: "2024-01-01T09:00:00Z", baseSalary: 12000, grade: "A1", reason: "Hire" },
  { id: "v2", effectiveFrom: "2025-04-01", recordedAt: "2025-03-20T09:00:00Z", baseSalary: 14500, grade: "A2", reason: "Merit" },
  { id: "v3", effectiveFrom: "2026-02-01", recordedAt: "2026-01-15T09:00:00Z", baseSalary: 18000, grade: "A3", reason: "Promotion" },
];

console.log("\n── Governing version ──");
eq("before the series starts, nothing governs", E.governing(SALARY, "2023-12-31"), null);
eq("on the first effective day", E.governing(SALARY, "2024-01-01").id, "v1");
eq("mid-way through the first period", E.governing(SALARY, "2025-03-31").id, "v1");
eq("on the day a change takes effect", E.governing(SALARY, "2025-04-01").id, "v2");
eq("long after the last version", E.governing(SALARY, "2030-01-01").id, "v3");
eq("malformed date governs nothing", E.governing(SALARY, "not-a-date"), null);
eq("empty series governs nothing", E.governing([], "2026-01-01"), null);

console.log("\n── Value lookup ──");
eq("salary as of a past date", E.valueAt(SALARY, "2024-06-01", "baseSalary"), 12000);
eq("salary after the raise", E.valueAt(SALARY, "2025-06-01", "baseSalary"), 14500);
eq("grade travels with the version", E.valueAt(SALARY, "2026-06-01", "grade"), "A3");
// Not an error: a record that starts later than the question is a real answer.
eq("before the record starts, the fallback", E.valueAt(SALARY, "2020-01-01", "baseSalary", 0), 0);
eq("unknown field falls back", E.valueAt(SALARY, "2026-06-01", "bonus", "n/a"), "n/a");

console.log("\n── Derived end dates ──");
{
  const s = E.series(SALARY);
  eq("one row per effective date", s.length, 3);
  eq("first period ends the day before the second starts", s[0].effectiveTo, "2025-03-31");
  eq("second period ends the day before the third", s[1].effectiveTo, "2026-01-31");
  eq("the open period has no end", s[2].effectiveTo, "");
  eq("ordered oldest first", s.map((r) => r.id), ["v1", "v2", "v3"]);
}
{
  const s = E.withCurrent(SALARY, "2025-06-01");
  eq("exactly one row is current", s.filter((r) => r.current).length, 1);
  eq("the right one is current", s.find((r) => r.current).id, "v2");
}

console.log("\n── Voided versions ──");
{
  // A version entered in error is retracted, never deleted.
  const withVoid = [...SALARY, { id: "bad", effectiveFrom: "2025-01-01", recordedAt: "2025-01-02T09:00:00Z", baseSalary: 99999, voided: true }];
  eq("a voided version never governs", E.governing(withVoid, "2025-02-01").id, "v1");
  eq("and never appears in the series", E.series(withVoid).map((r) => r.id), ["v1", "v2", "v3"]);
}

console.log("\n── Backdated correction (the important case) ──");
{
  /* In June 2025 someone notices the April raise was entered as 14500 when the
     agreed figure was 15200. The correction shares April's effective date but
     is recorded later, so it supersedes — without erasing what was believed. */
  const corrected = [
    ...SALARY,
    { id: "v2fix", effectiveFrom: "2025-04-01", recordedAt: "2025-06-10T09:00:00Z", baseSalary: 15200, grade: "A2", reason: "Correction" },
  ];

  eq("the correction governs April onward now", E.governing(corrected, "2025-05-01").id, "v2fix");
  eq("and its figure is what April should have paid", E.valueAt(corrected, "2025-05-01", "baseSalary"), 15200);

  // But what payroll believed in May was still the original — and that is why
  // the May payslip was what it was.
  eq("as known in May, the original still governed",
    E.governing(corrected, "2025-05-01", { knownAt: "2025-05-31T00:00:00Z" }).id, "v2");
  eq("as known in May, the original figure",
    E.governing(corrected, "2025-05-01", { knownAt: "2025-05-31T00:00:00Z" }).baseSalary, 14500);

  // The correction collapses into one visible period rather than two.
  eq("series shows one April period, not two", E.series(corrected).length, 3);
  eq("and it is the corrected version", E.series(corrected)[1].id, "v2fix");

  // The arrears window: what was paid vs what was owed.
  const w = E.retroWindow(corrected, "2025-04-01", "2025-06-09", { knownAt: "2025-05-31T00:00:00Z" });
  eq("a retro window is detected", !!w, true);
  eq("it names what was believed", w.believed.baseSalary, 14500);
  eq("and what actually applied", w.actual.baseSalary, 15200);
  eq("no window when nothing was corrected",
    E.retroWindow(SALARY, "2025-04-01", "2025-06-09", { knownAt: "2025-05-31T00:00:00Z" }), null);
}

console.log("\n── Future-dated changes ──");
{
  const today = "2026-01-20";
  eq("a change agreed but not yet in force is scheduled",
    E.scheduled(SALARY, today).map((v) => v.id), ["v3"]);
  eq("the current value is still the old one", E.valueAt(SALARY, today, "baseSalary"), 14500);
  eq("nothing scheduled once it takes effect", E.scheduled(SALARY, "2026-02-01"), []);
  eq("malformed today yields nothing rather than everything", E.scheduled(SALARY, "oops"), []);
}

console.log("\n── Change log ──");
{
  const log = E.changeLog(SALARY, ["baseSalary", "grade"]);
  eq("one entry per version", log.length, 3);
  eq("the first version reports every field as new", log[0].changes.length, 2);
  eq("later versions report only what moved",
    log[1].changes.map((c) => `${c.field}:${c.from}->${c.to}`),
    ["baseSalary:12000->14500", "grade:A1->A2"]);
  eq("the reason travels with the entry", log[2].reason, "Promotion");
}
{
  // A version that changes only one field must not report the other.
  const gradeOnly = [
    SALARY[0],
    { id: "g", effectiveFrom: "2025-01-01", recordedAt: "2025-01-01T00:00:00Z", baseSalary: 12000, grade: "A2", reason: "Regrade" },
  ];
  eq("unchanged fields are omitted",
    E.changeLog(gradeOnly, ["baseSalary", "grade"])[1].changes.map((c) => c.field), ["grade"]);
}

console.log("\n── Insert validation ──");
eq("a real change is accepted",
  E.checkInsert(SALARY, { effectiveFrom: "2026-06-01", baseSalary: 20000, grade: "A3" }, ["baseSalary", "grade"]),
  { ok: true });
eq("a missing effective date is refused",
  E.checkInsert(SALARY, { baseSalary: 20000 }, ["baseSalary"]),
  { ok: false, reason: "An effective date is required (YYYY-MM-DD)." });
// A no-op version pollutes every history view and answers no question.
eq("a version that changes nothing is refused",
  E.checkInsert(SALARY, { effectiveFrom: "2026-06-01", baseSalary: 18000, grade: "A3" }, ["baseSalary", "grade"]),
  { ok: false, reason: "Nothing changes — those values already apply from 2026-02-01." });
// Backdating is legitimate and must stay possible; corrections have nowhere
// else to go.
eq("backdating before the whole series is allowed",
  E.checkInsert(SALARY, { effectiveFrom: "2023-01-01", baseSalary: 9000 }, ["baseSalary"]),
  { ok: true });
eq("backdating into a covered period is allowed",
  E.checkInsert(SALARY, { effectiveFrom: "2025-06-01", baseSalary: 15200 }, ["baseSalary"]),
  { ok: true });
eq("first version into an empty series is allowed",
  E.checkInsert([], { effectiveFrom: "2026-01-01", baseSalary: 10000 }, ["baseSalary"]),
  { ok: true });

console.log("\n── Ordering stability ──");
{
  // Input order must not affect the answer.
  const shuffled = [SALARY[2], SALARY[0], SALARY[1]];
  eq("unsorted input still resolves correctly", E.governing(shuffled, "2025-06-01").id, "v2");
  eq("unsorted input still series-orders", E.series(shuffled).map((r) => r.id), ["v1", "v2", "v3"]);
}
{
  // Identical effective and recorded stamps must still order deterministically.
  const tied = [
    { id: "b", effectiveFrom: "2026-01-01", recordedAt: "2026-01-01T00:00:00Z", baseSalary: 2 },
    { id: "a", effectiveFrom: "2026-01-01", recordedAt: "2026-01-01T00:00:00Z", baseSalary: 1 },
  ];
  eq("ties break deterministically", E.series(tied).map((r) => r.id), ["b"]);
  eq("and the same way when reversed", E.series([tied[1], tied[0]]).map((r) => r.id), ["b"]);
}
{
  // A version with no recordedAt must not crash or win spuriously.
  const sparse = [
    { id: "n", effectiveFrom: "2025-01-01", baseSalary: 5 },
    { id: "m", effectiveFrom: "2025-01-01", recordedAt: "2025-02-01T00:00:00Z", baseSalary: 6 },
  ];
  eq("a recorded version supersedes an unstamped one",
    E.governing(sparse, "2025-06-01").id, "m");
}
eq("a malformed effectiveFrom is ignored, not sorted arbitrarily",
  E.series([...SALARY, { id: "junk", effectiveFrom: "", baseSalary: 1 }]).map((r) => r.id),
  ["v1", "v2", "v3"]);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

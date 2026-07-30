/* The directory query builder.

   The cases that matter most here are the visibility ones. A scope filter a
   query parameter can widen, or an empty scope that degrades to "everything",
   both fail open — and a filter that fails open is not a filter. */

const { buildEmployeeQuery, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } =
  await import("../src/lib/employees-query.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

console.log("\n── Default view ──");
{
  const { where, orderBy, skip, take } = buildEmployeeQuery();
  eq("hides exited and applicants by default", where.stage, { notIn: ["Exited", "Applicant"] });
  eq("sorts by name", orderBy, [{ fullNameEn: "asc" }]);
  eq("starts at the first page", skip, 0);
  eq("default page size", take, DEFAULT_PAGE_SIZE);
  eq("no stray AND clause", where.AND, undefined);
}
eq("includeExited surfaces leavers",
  buildEmployeeQuery({ includeExited: true }).where.stage, { notIn: ["Applicant"] });
eq("includeApplicants surfaces intake",
  buildEmployeeQuery({ includeApplicants: true }).where.stage, { notIn: ["Exited"] });
eq("both flags drop the stage filter entirely",
  buildEmployeeQuery({ includeExited: true, includeApplicants: true }).where.stage, undefined);
eq("an explicit stage wins over the default hiding",
  buildEmployeeQuery({ stage: "Exited" }).where.stage, "Exited");

console.log("\n── Filters ──");
eq("account", buildEmployeeQuery({ account: "Lenovo" }).where.account, "Lenovo");
eq("department", buildEmployeeQuery({ department: "Operations" }).where.department, "Operations");
eq("direct reports of a manager", buildEmployeeQuery({ managerId: "m1" }).where.directManagerId, "m1");
eq("blank filters are ignored, not matched as empty strings",
  (({ account, department, directManagerId }) => ({ account, department, directManagerId }))(
    buildEmployeeQuery({ account: "", department: "", managerId: "" }).where),
  { account: undefined, department: undefined, directManagerId: undefined });

console.log("\n── Search ──");
{
  const or = buildEmployeeQuery({ q: "  nour  " }).where.AND[0].OR;
  eq("trims the needle", or[0].fullNameEn.contains, "nour");
  eq("searches six fields", or.length, 6);
  eq("english name folds case", or[0].fullNameEn.mode, "insensitive");
  // Arabic is caseless; asking Postgres to fold it is a pointless index-defeat.
  eq("arabic name does not ask for case folding", or[1].fullNameAr.mode, undefined);
  eq("covers empId", or.some((c) => c.empId), true);
  eq("covers workEmail", or.some((c) => c.workEmail), true);
  eq("covers jobTitle", or.some((c) => c.jobTitle), true);
}
eq("whitespace-only search is not a filter", buildEmployeeQuery({ q: "   " }).where.AND, undefined);

console.log("\n── Visibility scope ──");
eq("scope becomes an id filter",
  buildEmployeeQuery({ scopeIds: ["a", "b"] }).where.AND, [{ id: { in: ["a", "b"] } }]);
// The critical one: "sees nobody" must not collapse into "sees everybody".
eq("an empty scope matches nothing",
  buildEmployeeQuery({ scopeIds: [] }).where.AND, [{ id: { in: [] } }]);
eq("no scope means unrestricted",
  buildEmployeeQuery({ scopeIds: undefined }).where.AND, undefined);
{
  // A search must narrow within the scope, never escape it.
  const { where } = buildEmployeeQuery({ scopeIds: ["a"], q: "dina" });
  eq("scope and search are both required (AND, not OR)", where.AND.length, 2);
  eq("scope clause survives alongside search", where.AND[0], { id: { in: ["a"] } });
}
{
  // Nor may a stage filter widen it.
  const { where } = buildEmployeeQuery({ scopeIds: ["a"], stage: "Exited", includeExited: true });
  eq("scope survives an explicit stage filter", where.AND, [{ id: { in: ["a"] } }]);
  eq("stage still applied", where.stage, "Exited");
}

console.log("\n── Pagination ──");
eq("page 3 of 20 skips 40", buildEmployeeQuery({ page: 3, pageSize: 20 }).skip, 40);
eq("page size is capped", buildEmployeeQuery({ pageSize: 100000 }).take, MAX_PAGE_SIZE);
eq("page 0 clamps to 1", buildEmployeeQuery({ page: 0 }).page, 1);
eq("negative page clamps to 1", buildEmployeeQuery({ page: -5 }).page, 1);
eq("zero page size clamps to a real page", buildEmployeeQuery({ pageSize: 0 }).take, DEFAULT_PAGE_SIZE);
eq("negative page size clamps up", buildEmployeeQuery({ pageSize: -10 }).take, 1);
eq("non-numeric page is ignored", buildEmployeeQuery({ page: "abc" }).page, 1);
eq("fractional page truncates", buildEmployeeQuery({ page: 2.9 }).page, 2);

console.log("\n── Sorting ──");
eq("newest", buildEmployeeQuery({ sort: "newest" }).orderBy, [{ createdAt: "desc" }]);
eq("hireDate", buildEmployeeQuery({ sort: "hireDate" }).orderBy, [{ hireDate: "desc" }]);
eq("empId", buildEmployeeQuery({ sort: "empId" }).orderBy, [{ empId: "asc" }]);
// An unknown sort must not reach Prisma as a column name.
eq("unknown sort falls back to name",
  buildEmployeeQuery({ sort: "'; drop table" }).orderBy, [{ fullNameEn: "asc" }]);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

/* Turning directory filters into a Prisma query — pure, so it is unit-testable
   without a database and cannot silently diverge from what the route sends.

   Same contract as buildCaseQuery in entries-query.js: the database does the
   filtering, ordering and slicing. Nothing here ever ships an unbounded read —
   "load every employee, then filter in JS" is cheap at twenty rows and a
   full-table scan per request at twenty thousand. */

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

/* Stages that are not part of the working population. Excluded by default so
   the directory shows staff, not the archive — but reachable on request,
   because an exited employee's record must never become unreachable. */
const ARCHIVED_STAGES = ["Exited"];
const PRE_HIRE_STAGES = ["Applicant"];

const SORTS = {
  name: [{ fullNameEn: "asc" }],
  newest: [{ createdAt: "desc" }],
  hireDate: [{ hireDate: "desc" }],
  empId: [{ empId: "asc" }],
};

/**
 * @param {object} [opts]
 * @param {string} [opts.q] free text over name, employee id, work email, job title
 * @param {string} [opts.account]
 * @param {string} [opts.department]
 * @param {string|string[]} [opts.stage] one EmploymentStage, or a set of them
 * @param {string} [opts.managerId] direct reports of this employee only
 * @param {string[]} [opts.scopeIds] hard visibility ceiling — when present the
 *   result can never include an id outside it, whatever the other filters say
 * @param {boolean} [opts.includeExited]
 * @param {boolean} [opts.includeApplicants]
 * @param {number} [opts.page] 1-based
 * @param {number} [opts.pageSize]
 * @param {string} [opts.sort] one of name | newest | hireDate | empId
 */
export function buildEmployeeQuery(opts = {}) {
  const {
    q, account, department, stage, managerId, scopeIds,
    includeExited = false, includeApplicants = false,
    page: rawPage, pageSize: rawSize, sort,
  } = opts;

  /** @type {Record<string, unknown>} */
  const where = {};
  /** @type {Array<Record<string, unknown>>} */
  const and = [];

  if (account) where.account = account;
  if (department) where.department = department;
  if (managerId) where.directManagerId = managerId;

  /* A stage filter may name one stage or a set of them. The set is what the
     journey views need: "joining" is Applicant, Onboarding and Probation
     together, and asking for them one at a time is three screens for one
     question. Either form is the caller being specific, so both override the
     default hiding of archived and pre-hire records — a view built to show
     applicants must not have applicants filtered out from under it. */
  const stages = Array.isArray(stage) ? stage.filter(Boolean) : (stage ? [stage] : []);
  if (stages.length === 1) {
    where.stage = stages[0];
  } else if (stages.length > 1) {
    where.stage = { in: stages };
  } else {
    const hidden = [
      ...(includeExited ? [] : ARCHIVED_STAGES),
      ...(includeApplicants ? [] : PRE_HIRE_STAGES),
    ];
    if (hidden.length) where.stage = { notIn: hidden };
  }

  /* The visibility ceiling is its own AND clause rather than a merged `id`
     filter, so a caller-supplied id filter can narrow it but never widen it.
     An empty scope means "sees nothing" and must produce no rows — not, as a
     falsy check would, every row. */
  if (Array.isArray(scopeIds)) and.push({ id: { in: scopeIds } });

  const needle = String(q ?? "").trim();
  if (needle) {
    and.push({
      OR: [
        { fullNameEn: { contains: needle, mode: "insensitive" } },
        { fullNameAr: { contains: needle } }, // Arabic has no case to fold
        { preferredName: { contains: needle, mode: "insensitive" } },
        { empId: { contains: needle, mode: "insensitive" } },
        { workEmail: { contains: needle, mode: "insensitive" } },
        { jobTitle: { contains: needle, mode: "insensitive" } },
      ],
    });
  }

  if (and.length) where.AND = and;

  const page = Math.max(1, Math.floor(Number(rawPage) || 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(rawSize) || DEFAULT_PAGE_SIZE)));

  return {
    where,
    orderBy: SORTS[sort] || SORTS.name,
    skip: (page - 1) * pageSize,
    take: pageSize,
    page,
    pageSize,
  };
}

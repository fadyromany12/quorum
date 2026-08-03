/* Employee persistence. The pure rules live in employee.js; this file is the
   only place that talks to Postgres about people.

   Two invariants it exists to hold:

   1. Every lifecycle change writes an EmployeeEvent in the same transaction as
      the change itself. A stage that moved without a timeline row is a record
      that lies, and "we'll log it afterwards" is how audit gaps happen.

   2. PII is never returned by accident. The directory select list is explicit
      and does not include the relation, so a careless `include` cannot leak an
      IBAN into a list endpoint. Reading PII is a separate, audited call. */

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  nextEmpId, checkTransition, stageChangeEvent, probationEnd, subordinateIds, annualEntitlement,
  FLEET_WIDE_ROLES, canViewEmployee,
} from "./employee.js";
import { todayStr } from "./dates.js";
import { buildEmployeeQuery } from "./employees-query.js";
import { GuardError } from "./api-guard";
import { encryptPii, decryptPii } from "./pii-crypto.js";
import { EXIT_REASONS } from "./taxonomy.js";

export type Actor = { id?: string; name: string; role: string };

/* Fields safe for any holder of employeeRead. Explicit rather than
   `include: {pii: false}` so adding a sensitive column to Employee later
   cannot silently join this list. */
export const DIRECTORY_SELECT = {
  id: true,
  empId: true,
  fullNameEn: true,
  fullNameAr: true,
  preferredName: true,
  workEmail: true,
  phone: true,
  jobTitle: true,
  department: true,
  account: true,
  lob: true,
  grade: true,
  workSite: true,
  stage: true,
  hireDate: true,
  probationEnd: true,
  exitDate: true,
  exitType: true,
  directManagerId: true,
  functionalManagerId: true,
  dottedManagerId: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmployeeSelect;

/** The directory shape, plus the fields a profile header needs. */
export const PROFILE_SELECT = {
  ...DIRECTORY_SELECT,
  gender: true,
  birthDate: true,
  personalEmail: true,
  linkedInUrl: true,
  addressAr: true,
  assets: true,
  exitReason: true,
  dependents: {
    select: { id: true, name: true, relation: true, birthDate: true, medicalCovered: true },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.EmployeeSelect;

/**
 * Leave entitlement is computed here rather than in the browser.
 *
 * Art. 47 has an age-50 route to the top tier, so the calculation needs a
 * birth date — and a directory listing has no business shipping birth dates to
 * every client just to derive one integer. Computing it server-side keeps the
 * date out of the payload and keeps one implementation of the rule.
 */
function withDerived<T extends { hireDate: string }>(row: T, birthDate: string, asOf: string) {
  return { ...row, entitlementDays: annualEntitlement({ hireDate: row.hireDate, birthDate }, asOf) };
}

/**
 * A page of the directory. `scopeIds` is the caller's visibility ceiling and is
 * enforced in SQL, not after the fact — filtering a page in JS would silently
 * return short pages and leak the total count.
 */
export async function listEmployees(opts: Parameters<typeof buildEmployeeQuery>[0]) {
  const { where, orderBy, skip, take, page, pageSize } = buildEmployeeQuery(opts);
  const w = where as Prisma.EmployeeWhereInput;
  const [rows, total] = await Promise.all([
    prisma.employee.findMany({
      where: w,
      orderBy: orderBy as Prisma.EmployeeOrderByWithRelationInput[],
      skip,
      take,
      // birthDate is selected for the entitlement calculation and stripped
      // below — it never reaches the response.
      select: { ...DIRECTORY_SELECT, birthDate: true },
    }),
    prisma.employee.count({ where: w }),
  ]);

  const asOf = todayStr();
  const employees = rows.map(({ birthDate, ...row }) => withDerived(row, birthDate, asOf));
  return { employees, total, page, pageSize };
}

/** Ids and manager links only — enough to compute the visibility subtree. */
export function loadOrgGraph() {
  return prisma.employee.findMany({ select: { id: true, directManagerId: true } });
}

/**
 * The set of employee ids this actor may see, or null for unrestricted.
 *
 * Returning `[]` rather than null for a manager with no employment record is
 * deliberate: "sees nothing" and "sees everything" must never be the same value.
 * A falsy check cannot tell them apart, and gets it wrong in the unsafe
 * direction. buildEmployeeQuery treats an empty array as a real, empty scope.
 */
export async function visibilityScope(actor: Actor & { id?: string }): Promise<string[] | null> {
  if (FLEET_WIDE_ROLES.includes(actor.role)) return null;
  if (!actor.id) return [];
  const me = await prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
  if (!me) return [];
  const graph = await loadOrgGraph();
  return [me.id, ...subordinateIds(me.id, graph)];
}

/**
 * Throw unless this actor may see this record.
 *
 * Lives here, next to visibilityScope, because the two must never disagree: a
 * record the directory filters out must not be reachable by id from any other
 * endpoint. Every route that takes an employee id calls this — authorization
 * re-derived per endpoint drifts, and the endpoint that drifts is the one
 * nobody audited.
 *
 * 404 rather than 403 on failure: confirming a record exists is itself a
 * disclosure, and "no such employee" is what an out-of-scope id should look
 * like from outside.
 */
export async function assertVisibleEmployee(
  actor: Actor & { id?: string },
  targetId: string,
): Promise<void> {
  if (FLEET_WIDE_ROLES.includes(actor.role)) return;
  const me = actor.id
    ? await prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } })
    : null;
  const graph = await loadOrgGraph();
  if (!canViewEmployee(actor.role, me?.id ?? null, targetId, graph)) {
    throw new GuardError(404, "No such employee.");
  }
}

export async function getEmployee(id: string) {
  const row = await prisma.employee.findUnique({ where: { id }, select: PROFILE_SELECT });
  // Same derivation as the directory, so the two screens can never disagree.
  return row ? withDerived(row, row.birthDate, todayStr()) : null;
}

export function getEmployeeByUserId(userId: string) {
  return prisma.employee.findUnique({ where: { userId }, select: PROFILE_SELECT });
}

/** The person's timeline, newest first. Bounded — a 20-year record is long. */
export function getTimeline(employeeId: string, limit = 200) {
  return prisma.employeeEvent.findMany({
    where: { employeeId },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: Math.min(500, Math.max(1, limit)),
  });
}

/**
 * Read PII. Separate call, separate permission, and it writes an audit row
 * before returning — an unaudited PII read is indistinguishable from
 * exfiltration after the fact.
 */
export async function readPii(employeeId: string, actor: Actor) {
  const [employee, pii] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId }, select: { empId: true, fullNameEn: true } }),
    prisma.employeePII.findUnique({ where: { employeeId } }),
  ]);
  if (!employee) return null;

  await prisma.auditLog.create({
    data: {
      actorId: actor.id ?? null,
      actorName: actor.name,
      actorRole: actor.role,
      action: "PII_READ",
      summary: `Viewed identifiers and bank details for ${employee.fullNameEn} (${employee.empId}).`,
      meta: { employeeId },
    },
  });

  /* Decrypt at the edge of persistence, so nothing above this layer has to know
     the columns are ciphertext — or remember to decrypt them.

     A failure here becomes a 409 with the real reason rather than a generic 500.
     "Internal error" on an HR record tells the person looking at it nothing, and
     the two things that actually cause this — a missing or rotated key, and a
     value that failed its authentication check — need completely different
     responses. Neither message discloses anything: the key is never in it, and
     someone who can trigger it already holds piiRead. */
  try {
    return { employee, pii: decryptPii(pii, employeeId) as typeof pii };
  } catch (e) {
    throw new GuardError(409, e instanceof Error ? e.message : "Could not read this record's identifiers.");
  }
}

/**
 * Write PII, encrypting the sensitive columns on the way in.
 *
 * Every path that writes these columns goes through here — the HR form and the
 * approved profile-change both — because encryption applied at call sites is
 * encryption that one call site eventually forgets. This file already exists to
 * be the only place that talks to Postgres about people; that is exactly the
 * property that makes it the right home for the cipher boundary.
 *
 * Takes a partial record: a profile change that verifies one field must not
 * blank the other fifteen.
 */
export async function writePii(employeeId: string, data: Record<string, string>) {
  const enc = encryptPii(data, employeeId) as Record<string, string>;
  const row = await prisma.employeePII.upsert({
    where: { employeeId },
    create: { employeeId, ...enc },
    update: enc,
  });
  return decryptPii(row, employeeId) as typeof row;
}

type EventInput = {
  type: string;
  title: string;
  detail?: string;
  fromVal?: string;
  toVal?: string;
  effectiveDate?: string;
  actorName?: string;
  actorRole?: string;
  caseId?: string | null;
  meta?: Prisma.InputJsonValue;
};

const eventRow = (employeeId: string, e: EventInput) => ({
  employeeId,
  type: e.type,
  title: e.title,
  detail: e.detail ?? "",
  fromVal: e.fromVal ?? "",
  toVal: e.toVal ?? "",
  effectiveDate: e.effectiveDate ?? "",
  actorName: e.actorName ?? "",
  actorRole: e.actorRole ?? "",
  caseId: e.caseId ?? null,
  meta: e.meta ?? {},
});

/** Append one timeline row. Exported for callers outside a transaction. */
export function writeEvent(employeeId: string, e: EventInput) {
  return prisma.employeeEvent.create({ data: eventRow(employeeId, e) });
}

/* Prisma's unique-constraint violation. Retried rather than surfaced, because
   two HR users admitting hires at the same moment is ordinary, not an error. */
const UNIQUE_VIOLATION = "P2002";
const EMP_ID_ATTEMPTS = 5;

/**
 * Create an employee, allocating the next sequential id.
 *
 * The id is derived from the existing set rather than a counter column because
 * any real deployment inherits historical ids it did not mint, and `ORDER BY`
 * on the string would break at the 9999→10000 boundary. Only the empId column is
 * fetched, and the race is closed by retrying on the unique violation rather
 * than trusting the read — a read-then-write cannot be made safe by reading
 * more carefully.
 */
export async function createEmployee(
  data: Omit<Prisma.EmployeeUncheckedCreateInput, "empId"> & { empId?: string },
  actor: Actor,
) {
  let lastErr: unknown;

  for (let attempt = 0; attempt < EMP_ID_ATTEMPTS; attempt++) {
    const empId = data.empId || nextEmpId((await prisma.employee.findMany({ select: { empId: true } })).map((r) => r.empId));

    const hireDate = String(data.hireDate ?? "");
    const row: Prisma.EmployeeUncheckedCreateInput = {
      ...data,
      empId,
      // Derived once at creation so the confirmation date is visible from day
      // one instead of being recomputed differently by each caller.
      probationEnd: data.probationEnd || (hireDate ? probationEnd(hireDate) : ""),
    };

    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.employee.create({ data: row, select: PROFILE_SELECT });
        await tx.employeeEvent.create({
          data: eventRow(created.id, {
            type: created.stage === "Applicant" ? "NOTE" : "HIRED",
            title: created.stage === "Applicant" ? "Application received" : "Joined the company",
            detail: [created.jobTitle, created.department, created.account].filter(Boolean).join(" · "),
            toVal: created.stage,
            effectiveDate: hireDate,
            actorName: actor.name,
            actorRole: actor.role,
          }),
        });
        return created;
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      // Only an explicitly supplied id is the caller's problem to fix.
      if (code !== UNIQUE_VIOLATION || data.empId) throw err;
      lastErr = err;
    }
  }

  throw lastErr ?? new Error("Could not allocate an employee id.");
}

/**
 * Move an employee to a new lifecycle stage.
 *
 * Validity is decided by the pure state machine, then the write and its
 * timeline row land in one transaction. Returns a reason instead of throwing on
 * an illegal transition so the route can pass it straight to the user.
 */
export async function transitionStage(
  employeeId: string,
  to: string,
  actor: Actor,
  opts: {
    effectiveDate?: string; detail?: string;
    exitType?: string; exitReason?: string; exitNote?: string;
  } = {},
) {
  const current = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, stage: true, fullNameEn: true, empId: true, hireDate: true, probationEnd: true },
  });
  if (!current) return { ok: false as const, status: 404, reason: "No such employee." };

  const check = checkTransition(current, to);
  if (!check.ok) return { ok: false as const, status: 409, reason: check.reason };

  /* The coded reason goes in the column, where it can be counted; the free-text
     note goes on the timeline event, where it can be read. Keeping them apart is
     what makes an attrition report possible without losing the specifics — a
     single field has to be either countable or expressive and cannot be both. */
  const exitLabel = opts.exitReason ? (EXIT_REASONS[opts.exitReason]?.label ?? opts.exitReason) : "";
  const detail = [opts.detail, exitLabel, opts.exitNote].filter(Boolean).join(" — ");

  const event = stageChangeEvent(current, to, actor, {
    effectiveDate: opts.effectiveDate ?? "",
    detail,
  });

  const patch: Prisma.EmployeeUpdateInput = { stage: to as Prisma.EmployeeUpdateInput["stage"] };
  if (to === "Exited") {
    patch.exitDate = opts.effectiveDate || "";
    if (opts.exitType) patch.exitType = opts.exitType as Prisma.EmployeeUpdateInput["exitType"];
    patch.exitReason = opts.exitReason ?? "";
  }
  // Entering probation without a computed end date leaves nothing to chase.
  if (to === "Probation" && !current.probationEnd && current.hireDate) {
    patch.probationEnd = probationEnd(current.hireDate);
  }

  const employee = await prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({ where: { id: employeeId }, data: patch, select: PROFILE_SELECT });
    await tx.employeeEvent.create({ data: eventRow(employeeId, event) });
    return updated;
  });

  return { ok: true as const, employee, event };
}

/* Fields a caller may PATCH. An allow-list, not a spread: stage changes go
   through transitionStage so they cannot skip the state machine, and empId is
   immutable once issued because payroll and disciplinary history point at it. */
const EDITABLE = [
  "fullNameEn", "fullNameAr", "preferredName", "personalEmail", "phone", "gender",
  "birthDate", "addressAr", "linkedInUrl", "jobTitle", "department", "account",
  "lob", "grade", "workSite", "hireDate", "probationEnd",
  "directManagerId", "functionalManagerId", "dottedManagerId", "assets",
] as const;

/**
 * Patch an employee's attributes, recording a timeline row for the changes that
 * belong on an HR record. A phone-number correction is not history; a promotion,
 * a transfer and a reporting-line change are.
 */
export async function updateEmployee(employeeId: string, body: Record<string, unknown>, actor: Actor) {
  const before = await prisma.employee.findUnique({ where: { id: employeeId }, select: PROFILE_SELECT });
  if (!before) return { ok: false as const, status: 404, reason: "No such employee." };

  const patch: Record<string, unknown> = {};
  for (const f of EDITABLE) if (body[f] !== undefined) patch[f] = body[f];
  if (!Object.keys(patch).length) return { ok: false as const, status: 400, reason: "Nothing to update." };

  // Self-reporting is a cycle of length one and breaks every tree walk.
  for (const link of ["directManagerId", "functionalManagerId", "dottedManagerId"] as const) {
    if (patch[link] === employeeId) {
      return { ok: false as const, status: 400, reason: "An employee cannot report to themselves." };
    }
  }

  const events: EventInput[] = [];
  const note = (type: string, title: string, field: keyof typeof before) => {
    const from = String(before[field] ?? "");
    const to = String(patch[field as string] ?? "");
    if (patch[field as string] === undefined || from === to) return;
    events.push({
      type, title, fromVal: from, toVal: to,
      effectiveDate: String(body.effectiveDate ?? ""),
      actorName: actor.name, actorRole: actor.role,
    });
  };

  note("PROMOTED", "Job title changed", "jobTitle");
  note("TRANSFERRED", "Moved account", "account");
  note("TRANSFERRED", "Moved department", "department");
  note("MANAGER_CHANGED", "Reporting line changed", "directManagerId");

  const employee = await prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({ where: { id: employeeId }, data: patch, select: PROFILE_SELECT });
    if (events.length) {
      await tx.employeeEvent.createMany({ data: events.map((e) => eventRow(employeeId, e)) });
    }
    return updated;
  });

  return { ok: true as const, employee, events };
}

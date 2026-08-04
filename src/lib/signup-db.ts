/* Sign-up persistence. The rules live in signup.js; this is the only file that
   writes an application to Postgres.

   Two things it exists to hold:

   1. The User and the Employee are created in one transaction. A login with no
      person behind it is an account nobody owns, and a person with no login is
      an application nobody can ever act on — either half alone is worse than
      neither.

   2. Nothing here trusts the caller. The manager list, the joining code and the
      applicant's own stage are all re-checked server-side, because the form
      that produced this request is served to the open internet. */

import { prisma } from "./prisma";
import { GuardError } from "./api-guard";
import { writeAudit } from "./db";
import { hashPassword } from "./passwords";
import { todayStr } from "./dates.js";
import { nextEmpId } from "./employee.js";
import { checkSignup, signupEffects, decisionEffects, canDecideSignup } from "./signup.js";

/* Roles that can be the far end of "who do you report to". Deliberately not
   every role: WFM and IT Support hold no line management, and offering them
   makes the menu a directory rather than a choice. */
const MANAGER_ROLES = ["OperationsLead", "ProjectManager", "HRBusinessPartner", "SuperAdmin"];

/** Stages whose holder is actually at work and can approve somebody. */
const WORKING = ["Probation", "Active", "OnPip", "Notice"] as const;

/**
 * The pickable managers, as an unauthenticated caller may see them.
 *
 * Name, title and account only. No email address, no employee id that means
 * anything outside this app, no headcount — this endpoint sits behind the
 * joining code but it is still the org chart, and the version of it worth
 * scraping is the one with addresses in it.
 */
export async function pickableManagers() {
  const rows = await prisma.employee.findMany({
    where: {
      stage: { in: [...WORKING] },
      OR: [
        { user: { role: { in: MANAGER_ROLES as never[] }, active: true } },
        // Anyone who already has reports is a manager whatever their login says.
        { directReports: { some: {} } },
      ],
    },
    select: { id: true, fullNameEn: true, preferredName: true, jobTitle: true, account: true },
    orderBy: { fullNameEn: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.preferredName || r.fullNameEn,
    jobTitle: r.jobTitle,
    account: r.account,
  }));
}

/**
 * Record an application: a disabled login and an Applicant employment record,
 * written together or not at all.
 *
 * Validation runs twice on purpose — once in the browser for the applicant's
 * sake and once here, against a manager list and an address list the browser
 * did not supply.
 */
export async function createApplication(
  payload: Record<string, unknown>,
  { domains = [] as string[] } = {},
) {
  const managers = await pickableManagers();
  const taken = await prisma.user.findMany({ select: { email: true } });

  const { problems } = checkSignup(payload, {
    managers,
    takenEmails: taken.map((u) => u.email),
    domains,
    today: todayStr(),
  });
  if (problems.length) throw new GuardError(400, problems[0]);

  const password = String((payload as { password?: unknown }).password ?? "");
  const fx = signupEffects(payload);

  /* The employee id is allocated inside the transaction from the ids that
     exist at that moment. Two people submitting at once is rare and a collision
     is a unique-constraint error rather than a duplicate — the caller retries
     rather than the database inventing a second EMP-1042. */
  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.employee.findMany({ select: { empId: true } });
    const empId = nextEmpId(existing.map((e) => e.empId));

    const user = await tx.user.create({
      data: { ...fx.user, empId, passHash: hashPassword(password), role: "Agent" },
      select: { id: true, email: true, name: true },
    });

    const employee = await tx.employee.create({
      data: { ...fx.employee, empId, userId: user.id, stage: "Applicant" },
      select: { id: true, empId: true, fullNameEn: true, directManagerId: true },
    });

    /* The timeline starts with the fact that they applied, so a record that is
       later approved reads as a sequence rather than appearing fully formed. */
    await tx.employeeEvent.create({
      data: {
        employeeId: employee.id,
        type: "NOTE",
        title: "Applied through self sign-up",
        detail: "Waiting on their chosen manager to approve the application.",
        toVal: "Applicant",
        actorName: employee.fullNameEn,
        actorRole: "Applicant",
      },
    });

    return { user, employee };
  });

  await writeAudit({
    actor: { name: created.employee.fullNameEn, role: "Applicant" },
    action: "SIGNUP_SUBMITTED",
    summary: `${created.employee.fullNameEn} applied through self sign-up and is waiting on approval.`,
    meta: { employeeId: created.employee.id, empId: created.employee.empId, managerId: created.employee.directManagerId },
  });

  return { empId: created.employee.empId, name: created.employee.fullNameEn };
}

/** Applications the caller may act on. HR and the Super Admin see all of them. */
export async function listApplications(actor: { role: string; employeeId?: string | null }) {
  const fleet = ["SuperAdmin", "HRBusinessPartner"].includes(actor.role);
  if (!fleet && !actor.employeeId) return [];

  const rows = await prisma.employee.findMany({
    where: {
      stage: "Applicant",
      // Self sign-ups only. An applicant HR typed in by hand has no login and
      // is not waiting on this queue.
      userId: { not: null },
      ...(fleet ? {} : { directManagerId: actor.employeeId as string }),
    },
    select: {
      id: true, empId: true, fullNameEn: true, fullNameAr: true, workEmail: true,
      phone: true, birthDate: true, jobTitle: true, createdAt: true,
      directManagerId: true,
      directManager: { select: { fullNameEn: true, preferredName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    managerName: r.directManager?.preferredName || r.directManager?.fullNameEn || "",
    directManager: undefined,
  }));
}

/**
 * Approve or decline an application.
 *
 * Approval is where the account actually starts working, so this is the only
 * path that sets `active` on a self-signed-up user — and it re-reads the
 * applicant inside the transaction rather than trusting what the list showed,
 * because two managers clicking at once must not produce two approvals.
 */
export async function decideApplication(
  id: string,
  decision: "approve" | "reject",
  actor: { id?: string; name: string; role: string; employeeId?: string | null },
  note = "",
) {
  const applicant = await prisma.employee.findUnique({
    where: { id },
    select: { id: true, empId: true, fullNameEn: true, stage: true, userId: true, directManagerId: true },
  });
  if (!applicant) throw new GuardError(404, "No such application.");
  if (applicant.stage !== "Applicant") {
    throw new GuardError(409, `${applicant.fullNameEn} is already past the application stage.`);
  }
  if (!applicant.userId) throw new GuardError(400, "That applicant did not sign up themselves.");
  if (!canDecideSignup({ role: actor.role, employeeId: actor.employeeId }, applicant)) {
    throw new GuardError(403, "Only the manager this application was addressed to, or HR, can decide it.");
  }

  const fx = decisionEffects(decision, { note, deciderName: actor.name, today: todayStr() });

  await prisma.$transaction(async (tx) => {
    // Re-read under the transaction: the stage is the lock.
    const fresh = await tx.employee.findUnique({ where: { id }, select: { stage: true } });
    if (fresh?.stage !== "Applicant") throw new GuardError(409, "That application was already decided.");

    await tx.employee.update({ where: { id }, data: fx.employee as never });
    await tx.user.update({ where: { id: applicant.userId as string }, data: fx.user });
    await tx.employeeEvent.create({
      data: {
        employeeId: id,
        type: fx.event.type,
        title: decision === "approve" ? "Application approved" : "Application declined",
        detail: fx.event.summary,
        fromVal: "Applicant",
        toVal: fx.employee.stage,
        actorName: actor.name,
        actorRole: actor.role,
      },
    });
  });

  await writeAudit({
    actor,
    action: decision === "approve" ? "SIGNUP_APPROVED" : "SIGNUP_REJECTED",
    summary: fx.event.summary.replace(/^Application/, `${applicant.fullNameEn}'s application`),
    meta: { employeeId: id, empId: applicant.empId, decision },
  });

  return { ok: true, stage: fx.employee.stage };
}

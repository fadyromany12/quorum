/* Shared seeding core — used by `prisma db seed` and by the SuperAdmin
   factory-reset endpoint, so both produce byte-identical baselines. */

import bcrypt from "bcryptjs";
import { DEFAULT_DCM } from "./dcm.js";
import { DEFAULT_ACCOUNTS, DEFAULT_TLS } from "./constants.js";
import { DEFAULT_PASSWORD } from "./auth.js";
import { buildSamples } from "./samples.js";
import { buildEmployeeSeed } from "./employee-samples.js";
import { settleDeductions } from "./deductions.js";
import { statusOf } from "./engine.js";
import { probationEnd } from "./employee.js";

export const SEED_USERS = [
  { name: "Fady Bekhet", email: "fady.bekhet@konecta.com", role: "SuperAdmin" },
  { name: "Salma Elhadad", email: "salma.elhadad@konecta.com", role: "WFM" },
  { name: "Ibrahim Kamel", email: "ibrahim.kamel@konecta.com", role: "ProjectManager" },
  { name: "Mohamed Rashad", email: "mohamed.rashad@konecta.com", role: "OperationsLead" },
  { name: "Abdallah Ismail", email: "abdallah.ismail@konecta.com", role: "HRBusinessPartner" },
  // Agent logins map to their case history via empId/email.
  { name: "Nour Said", email: "nour.said@demo.konecta", role: "Agent", empId: "EG0412" },
  { name: "Karim Adel", email: "karim.adel@demo.konecta", role: "Agent", empId: "EG0388" },
  { name: "Dina Samy", email: "dina.samy@demo.konecta", role: "Agent", empId: "EG0533" },
];

function toRow(e) {
  const { createdAt, resetOn, ...rest } = e;
  return {
    ...rest,
    lob: e.lob || "",
    agentName: e.agentName || "",
    executorName: e.executorName || "",
    tardyMin: e.tardyMin || 0,
    earlyMin: e.earlyMin || 0,
    compMin: e.compMin || 0,
    occurrence: e.occurrence ?? null,
    severity: e.severity ?? null,
    activity: e.activity || [],
    hrRef: e.hrRef || "",
    createdAt: new Date(createdAt || Date.now()),
  };
}

/**
 * The demo org chart, in three passes.
 *
 * Manager links are declared by email in the fixture, so the rows have to exist
 * before they can point at each other — resolving ids up front would force the
 * fixture to be written in insertion order rather than as an org chart. The
 * third pass attaches logins where a User with the same email exists.
 */
async function seedEmployees(prisma, { actorName, actorRole }) {
  const fixture = buildEmployeeSeed();

  await prisma.employee.createMany({
    data: fixture.map(({ _managerEmail, _functionalEmail, ...e }) => ({
      ...e,
      // Derived here so the seeded records match what createEmployee would
      // have produced, rather than carrying blank confirmation dates.
      probationEnd: e.hireDate ? probationEnd(e.hireDate) : "",
    })),
  });

  const rows = await prisma.employee.findMany({ select: { id: true, workEmail: true, stage: true, hireDate: true, jobTitle: true, department: true, account: true } });
  const idByEmail = new Map(rows.map((r) => [r.workEmail, r.id]));

  for (const e of fixture) {
    const directManagerId = e._managerEmail ? idByEmail.get(e._managerEmail) ?? null : null;
    const functionalManagerId = e._functionalEmail ? idByEmail.get(e._functionalEmail) ?? null : null;
    if (!directManagerId && !functionalManagerId) continue;
    await prisma.employee.update({
      where: { workEmail: e.workEmail },
      data: { directManagerId, functionalManagerId },
    });
  }

  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  for (const u of users) {
    const employeeId = idByEmail.get(u.email);
    if (employeeId) await prisma.employee.update({ where: { id: employeeId }, data: { userId: u.id } });
  }

  /* Seed the timeline too. A profile whose history starts the day the database
     was created looks broken; the hire event is the one thing every record has. */
  await prisma.employeeEvent.createMany({
    data: rows.map((r) => ({
      employeeId: r.id,
      at: r.hireDate ? new Date(`${r.hireDate}T09:00:00Z`) : new Date(),
      effectiveDate: r.hireDate,
      type: r.stage === "Applicant" ? "NOTE" : "HIRED",
      title: r.stage === "Applicant" ? "Application received" : "Joined the company",
      detail: [r.jobTitle, r.department, r.account].filter(Boolean).join(" · "),
      /* Deliberately no toVal. The seed knows each employee's *current* stage,
         not the stage they were hired into — writing today's stage onto a
         backdated hire event would claim someone was hired straight onto a PIP.
         createEmployee does record toVal, because there the two genuinely
         coincide. */
      actorName,
      actorRole,
    })),
  });

  return rows.length;
}

/** Wipes every app table and reseeds. Returns a summary for logging. */
export async function seedAll(prisma, { actorName = "system", actorRole = "SuperAdmin" } = {}) {
  /* Order matters: EmployeeEvent and EmployeePII cascade from Employee, but
     Employee's own self-relations do not, so its rows go before User's (which
     Employee.userId points at with SetNull). */
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.employeeEvent.deleteMany(),
    prisma.employeePII.deleteMany(),
    prisma.dependent.deleteMany(),
    prisma.employee.deleteMany(),
    prisma.case.deleteMany(),
    prisma.dcmRule.deleteMany(),
    prisma.appConfig.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const passHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
  await prisma.user.createMany({ data: SEED_USERS.map((u) => ({ ...u, passHash, mustChange: true })) });
  await prisma.dcmRule.createMany({ data: DEFAULT_DCM.map((r, i) => ({ ...r, sort: i })) });
  await prisma.appConfig.create({ data: { id: 1, accounts: DEFAULT_ACCOUNTS, tls: DEFAULT_TLS } });

  const entries = settleDeductions(buildSamples(DEFAULT_TLS, DEFAULT_DCM));
  const rows = entries.map((e) => ({
    ...toRow(e),
    // Closed disciplinary cases owe the agent a digital acknowledgement.
    requiresAcknowledgement: e.disciplinary && statusOf(e) === "Closed",
  }));
  await prisma.case.createMany({ data: rows });

  const employees = await seedEmployees(prisma, { actorName, actorRole });

  const summary =
    `Database seeded: ${SEED_USERS.length} users, ${employees} employees, ` +
    `${DEFAULT_DCM.length} DCM rules, ${rows.length} cases.`;
  await prisma.auditLog.create({
    data: { actorName, actorRole, action: "FACTORY_RESET", summary },
  });

  return { users: SEED_USERS.length, cases: rows.length, pendingAcks: rows.filter((r) => r.requiresAcknowledgement).length, summary };
}

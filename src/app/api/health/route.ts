/* GET /api/health — what protections are actually switched on.

   "We encrypt PII" and "we encrypt PII when someone remembered to set the
   variable" are different claims, and only one of them is checkable. This
   endpoint makes the second one impossible to hold by accident: an operator can
   see, at a glance, that the key is loaded, the mailer is wired and the sweep
   can run.

   Admin-only, and it reports whether each secret is *present*, never what it
   is — a health endpoint that echoes configuration is a configuration leak. */

import { NextResponse } from "next/server";
import { requireRole, guarded } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { encryptionStatus, ENCRYPTED_PII_FIELDS, isEncrypted } from "@/lib/pii-crypto.js";
import { readPayroll, toPercent } from "@/lib/payroll-config.js";

export const GET = guarded(async () => {
  await requireRole("admin");

  const enc = encryptionStatus();

  /* Readiness of the in-app configuration, gathered in one pass. Each of these
     is a thing that is built, deployed, and does nothing until a person enters
     a value — the state that looks identical to a bug from the outside. */
  const [config, withSalary, activeEmployees, itAccounts, forecastRows, patterns] = await Promise.all([
    prisma.appConfig.findUnique({ where: { id: 1 }, select: { payroll: true } }),
    prisma.compensationRecord.findMany({ where: { voided: false }, select: { employeeId: true }, distinct: ["employeeId"] }),
    prisma.employee.count({ where: { stage: { notIn: ["Exited", "Applicant"] } } }),
    prisma.user.count({ where: { role: "ITSupport" } }),
    prisma.forecast.findMany({ select: { date: true }, distinct: ["date"] }),
    prisma.shiftPattern.count({ where: { active: true } }),
  ]);
  const payroll = readPayroll(config?.payroll);
  const forecastDays = forecastRows.length;

  /* How much of the estate is actually encrypted. Without this the health check
     answers "is the key set", which is not the question — a key set last week
     over a table written to for a year leaves most rows in the clear until each
     one is next saved. Sampling answers the real question. */
  const sample = await prisma.employeePII.findMany({
    take: 200,
    select: Object.fromEntries(ENCRYPTED_PII_FIELDS.map((f) => [f, true])),
  });
  let withValues = 0;
  let encrypted = 0;
  for (const row of sample) {
    for (const f of ENCRYPTED_PII_FIELDS) {
      const v = (row as Record<string, string>)[f];
      if (!v) continue;
      withValues++;
      if (isEncrypted(v)) encrypted++;
    }
  }

  /* "Not set" is accurate and unhelpful on its own. The overwhelmingly common
     cause is not a missing variable but a variable saved after the last build:
     hosts bake the environment in at build time, so saving one changes nothing
     until something rebuilds. Saying so here turns a dead end into a next step.

     Only shown when the variable is absent entirely — if it is present but
     malformed, the length is the problem and a rebuild will not fix it. */
  const notSet = !enc.active && /not set/i.test(enc.problem ?? "");
  const hint = notSet
    ? "Set in the host but still missing here? The environment is baked in at build time — redeploy so a new build picks it up, and check the variable applies to this environment."
    : null;

  return NextResponse.json({
    piiEncryption: {
      active: enc.active,
      problem: enc.problem,
      hint,
      fields: ENCRYPTED_PII_FIELDS,
      // "0 of 0" is the honest answer for an empty table, not "100%".
      storedValues: withValues,
      encryptedValues: encrypted,
      pctEncrypted: withValues ? Math.round((encrypted / withValues) * 100) : null,
      note: withValues > encrypted
        ? "Values written before encryption was switched on stay readable until each record is next saved."
        : null,
    },
    // Same reasoning as the hint above: these two fail the same way, for the
    // same reason, and a bare `false` sends the reader looking in the wrong place.
    email: { configured: !!process.env.RESEND_API_KEY, hint: process.env.RESEND_API_KEY ? null : hint },
    scheduledJobs: { configured: !!process.env.CRON_SECRET, hint: process.env.CRON_SECRET ? null : hint },

    /* Readiness of the things that are configured in the app rather than in the
       environment. These were the questions being answered by me remembering
       them out loud, which is not a mechanism. A feature that is built but
       unusable until someone types a number is indistinguishable from a broken
       one, so the app says which. */
    payroll: {
      ratesConfigured: payroll.configured,
      socialInsurancePct: payroll.configured ? toPercent(payroll.socialInsuranceRate) : null,
      taxPct: payroll.configured ? toPercent(payroll.taxRate) : null,
      employeesWithSalary: withSalary.length,
      employeesWithoutSalary: Math.max(0, activeEmployees - withSalary.length),
      issuable: withSalary.length > 0,
      hint:
        withSalary.length === 0
          ? "No employee has a salary on record, so no payslip can be issued. Set one on any employee record under Pay."
          : !payroll.configured
            ? "Payslips will show earnings and absence but state they are not a final net figure until the rates are set in Settings."
            : null,
    },
    accountRecovery: {
      delivery: process.env.RESET_DELIVERY === "email" ? "email" : "itIssued",
      itAccounts: itAccounts,
      hint:
        itAccounts === 0
          ? "No IT Support account exists, so only a Super Admin can issue a recovery code. Create one under Accounts."
          : null,
    },
    workforcePlanning: {
      forecastDays: forecastDays,
      shiftPatterns: patterns,
      hint:
        forecastDays === 0
          ? "No demand forecast has been loaded, so the planning screen has nothing to size against."
          : patterns === 0
            ? "No shift patterns are defined, so every roster row has to be typed by hand."
            : null,
    },
  });
});

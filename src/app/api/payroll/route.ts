/* GET/PUT /api/payroll — the statutory rates every payslip is measured against.

   Read by anyone who may see a payslip, written only by an admin. A rate change
   silently alters what every employee is paid next month, so it is the narrowest
   write in the system and it is audited with both the old and the new values —
   "the tax rate changed" is useless in an investigation; "it went from 10% to
   0% on the 3rd, set by X" is the whole answer.

   The rates are stored on the AppConfig singleton rather than a table of their
   own. They are one row that changes a few times a decade; a table would be a
   table with one row and a migration for every field finance later asks for. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";
import { can } from "@/lib/auth.js";
import { readPayroll, checkPayroll, toPercent } from "@/lib/payroll-config.js";

export const GET = guarded(async () => {
  const actor = await requireRole(null);
  /* Deliberately readable by anyone with a payslip of their own: the rate that
     produced a deduction is part of explaining the deduction. */
  const row = await prisma.appConfig.findUnique({ where: { id: 1 }, select: { payroll: true } });
  const payroll = readPayroll(row?.payroll);
  return NextResponse.json({
    ...payroll,
    socialInsurancePct: toPercent(payroll.socialInsuranceRate),
    taxPct: toPercent(payroll.taxRate),
    canEdit: can({ role: actor.role }, "admin"),
  });
});

export const PUT = guarded(async (req: Request) => {
  const actor = await requireRole("admin");
  const body = await req.json().catch(() => ({}));
  const check = checkPayroll(body);
  if (!check.ok) throw new GuardError(400, check.reason);

  const before = readPayroll(
    (await prisma.appConfig.findUnique({ where: { id: 1 }, select: { payroll: true } }))?.payroll
  );

  const payroll = {
    configured: true,
    socialInsuranceRate: check.socialInsuranceRate,
    taxRate: check.taxRate,
    note: check.note,
    updatedBy: actor.name,
    updatedAt: new Date().toISOString(),
  };

  /* The singleton may not exist yet on a fresh database, and accounts/tls are
     required on create — seeded empty rather than guessed at. */
  await prisma.appConfig.upsert({
    where: { id: 1 },
    create: { id: 1, accounts: [], tls: [], payroll },
    update: { payroll },
  });

  await writeAudit({
    actor,
    action: "PAYROLL_RATES_UPDATED",
    summary: `Payroll rates set to ${toPercent(payroll.socialInsuranceRate)}% social insurance, ${toPercent(payroll.taxRate)}% income tax`,
    meta: {
      from: before.configured
        ? { socialInsurancePct: toPercent(before.socialInsuranceRate), taxPct: toPercent(before.taxRate) }
        : "not configured",
      to: { socialInsurancePct: toPercent(payroll.socialInsuranceRate), taxPct: toPercent(payroll.taxRate) },
      note: payroll.note,
    },
  });

  return NextResponse.json({
    ...payroll,
    socialInsurancePct: toPercent(payroll.socialInsuranceRate),
    taxPct: toPercent(payroll.taxRate),
    canEdit: true,
  });
});

/* GET /api/payslips?employeeId=&period=YYYY-MM
   A month's payslip, assembled from records the app already holds.

   ── Who may see one ────────────────────────────────────────────────────────
   The subject, and holders of piiRead. Deliberately *not* the person's line
   manager: a lead legitimately needs to know who reports to them, when they
   are rostered and whether they turned up, and none of that requires knowing
   what they are paid. Salary is the most reliably misused fact in an
   organisation, and the same argument that keeps an IBAN behind piiRead keeps
   a payslip there.

   ── Where each figure comes from ───────────────────────────────────────────
   Nothing is invented, and the response says so per line via `sources`:

     · Base pay — the CompensationRecord in force on the last day of the
       period. In force, not most recent: a raise effective in September must
       not appear on August's slip, and a slip regenerated next year has to
       produce the same figure it did the day it was issued.
     · Overtime — Overtime rows on the roster for the period.
     · Unpaid days — approved leave requests whose leave type is unpaid in the
       taxonomy. Paid leave is not a deduction and must never appear as one.
     · Disciplinary days — deductionApplied on cases dated in the period, which
       the discipline engine has already capped per case. The Art. 60 monthly
       cap is applied again in payslip.js, because a month can accumulate cases
       from more than one source.

   Reading is audited. An unaudited read of someone else's pay is
   indistinguishable from curiosity after the fact, which is the same reason
   readPii audits. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";
import { can } from "@/lib/auth.js";
import { buildPayslip, checkPayslip } from "@/lib/payslip.js";
import { toMinor } from "@/lib/comp.js";
import { LEAVE_TYPES } from "@/lib/taxonomy.js";
import { statusOf } from "@/lib/workflow.js";
import { readPayroll } from "@/lib/payroll-config.js";
import { toRequest } from "@/lib/workflow-db";

const isPeriod = (s: string) => /^\d{4}-\d{2}$/.test(s);

/** First and last calendar day of a YYYY-MM period. */
function bounds(period: string) {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}`, days: last };
}

/** Leave codes the taxonomy marks unpaid — the only ones that reduce pay. */
const UNPAID_LEAVE = new Set(
  Object.entries(LEAVE_TYPES as Record<string, { paid?: boolean }>)
    .filter(([, v]) => v.paid === false)
    .map(([k]) => k)
);

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const q = new URL(req.url).searchParams;
  const period = q.get("period") ?? "";
  if (!isPeriod(period)) throw new GuardError(400, "A period (YYYY-MM) is required.");

  const mine = await prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
  const employeeId = q.get("employeeId") || mine?.id || "";
  if (!employeeId) throw new GuardError(409, "Your login is not linked to an employment record yet — HR can link it.");

  const isSelf = mine?.id === employeeId;
  if (!isSelf && !can({ role: actor.role }, "piiRead")) {
    /* Deliberately 404 rather than 403 for someone else's payslip: confirming
       that a payslip exists for a given employee id is itself information. */
    throw new GuardError(404, "No such payslip.");
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, empId: true, fullNameEn: true, fullNameAr: true, jobTitle: true, account: true, lob: true, hireDate: true },
  });
  if (!employee) throw new GuardError(404, "No such payslip.");

  const { from, to } = bounds(period);

  const [pay, roster, cases, leave, config] = await Promise.all([
    /* In force on the last day of the period. A raise dated mid-period is a
       proration question this does not pretend to answer — it takes the rate
       that governs the month and says which record it used. */
    prisma.compensationRecord.findFirst({
      where: { employeeId, voided: false, effectiveFrom: { lte: to } },
      orderBy: [{ effectiveFrom: "desc" }, { recordedAt: "desc" }],
    }),
    prisma.scheduleEntry.findMany({
      where: { employeeId, date: { gte: from, lte: to } },
      include: { pattern: { select: { paidBreakMinutes: true, unpaidBreakMinutes: true } } },
    }),
    prisma.case.findMany({
      where: { empId: employee.empId, date: { gte: from, lte: to }, voided: false },
      select: { id: true, date: true, deductionApplied: true, violation: true },
    }),
    prisma.request.findMany({
      where: { subjectId: employeeId, type: "leave" },
      include: { steps: true, subject: true },
    }),
    prisma.appConfig.findUnique({ where: { id: 1 }, select: { payroll: true } }),
  ]);

  /* Absent or unusable rates read as unconfigured, never as zero. The payslip
     then says on its face that it is not a final net figure rather than
     printing a 0.00 tax line that looks like a calculation. */
  const statutory = readPayroll(config?.payroll);

  const rosterRows = roster.map((r) => ({
    ...r,
    paidBreakMinutes: r.pattern?.paidBreakMinutes ?? 0,
    unpaidBreakMinutes: r.pattern?.unpaidBreakMinutes ?? 0,
  }));

  /* Only approved unpaid leave overlapping this period. An approved request is
     the authority for the deduction; a pending one is not, and deducting for it
     would take money for a decision nobody has made. */
  let unpaidDays = 0;
  const unpaidRefs: string[] = [];
  for (const row of leave) {
    /* Through the same mapper the inbox uses, so "how many days were actually
       granted" is answered once. Granted, not requested: a partial approval of
       three days out of five deducts three. */
    const r = toRequest(row as never) as unknown as {
      id: string;
      payload?: { leaveType?: string; from?: string; to?: string };
      grantedUnits?: number | null;
      requestedUnits?: number | null;
    };
    const p = r.payload ?? {};
    if (!p.leaveType || !UNPAID_LEAVE.has(p.leaveType)) continue;
    if (statusOf(r as never) !== "approved") continue;
    const start = p.from ?? "";
    const end = p.to || start;
    if (!start || end < from || start > to) continue;
    const days = Number(r.grantedUnits ?? r.requestedUnits ?? 0);
    if (days > 0) {
      unpaidDays += days;
      unpaidRefs.push(r.id);
    }
  }

  const disciplinaryDeductionDays = cases.reduce((s, c) => s + (c.deductionApplied || 0), 0);

  const slip = buildPayslip({
    period,
    baseMonthlyMinor: pay ? (toMinor(String(pay.baseSalary)) ?? 0) : 0,
    roster: rosterRows,
    unpaidDays,
    disciplinaryDeductionDays,
    statutory,
    currency: pay?.currency ?? "EGP",
  });
  const problems = checkPayslip(slip);

  if (!isSelf) {
    await writeAudit({
      actor,
      action: "PAYSLIP_VIEWED",
      summary: `Viewed ${employee.fullNameEn}'s payslip for ${period}`,
      meta: { employeeId, period, issuable: problems.length === 0 },
    });
  }

  return NextResponse.json({
    employee,
    ...slip,
    problems,
    issuable: problems.length === 0,
    /* Where every figure came from, so a dispute starts from the record rather
       than from an argument about the number. */
    sources: {
      salaryRecordId: pay?.id ?? null,
      salaryEffectiveFrom: pay?.effectiveFrom ?? null,
      overtimeRows: rosterRows.filter((r) => r.activity === "Overtime").length,
      unpaidLeaveRequestIds: unpaidRefs,
      disciplinaryCaseIds: cases.filter((c) => c.deductionApplied > 0).map((c) => c.id),
      statutoryRatesSetBy: statutory.configured ? statutory.updatedBy : null,
      statutoryRatesSetAt: statutory.configured ? statutory.updatedAt : null,
    },
  });
});

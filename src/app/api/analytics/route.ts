/* GET /api/analytics?from=&to=&account=
   Headcount movement, attrition, leave liability and the people worth a
   conversation — for one window, in one read.

   ── Who sees what ──────────────────────────────────────────────────────────
   Two tiers, because these are two different things. Headcount and attrition
   are management information: a lead running a team needs to know they lost
   four people last quarter. Leave liability is money, so it sits behind
   piiRead alongside the salaries it is computed from — and it is simply absent
   from the response for everyone else rather than zeroed, so nothing on screen
   can mistake "you may not see this" for "there is no liability".

   Flight-risk signals are scoped like the directory. A lead sees their own
   people; nobody browses the whole floor's risk list, because that list is the
   most quietly damaging artefact this system could produce.

   ── Why so much is computed rather than counted in SQL ─────────────────────
   Every figure here comes from analytics.js, which is pure and tested. A
   `count(*) where stage = 'Active'` in this file would be a second definition
   of headcount, and the two would disagree the first time somebody changed
   what "employed" means. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/auth.js";
import { visibilityScope } from "@/lib/employee-db";
import { waterfall, attritionRate, attritionSplit, leaveLiability, flightRisk, byMonth } from "@/lib/analytics.js";
import { balanceOf } from "@/lib/leave.js";
import { attritionClass } from "@/lib/taxonomy.js";
import { todayStr, addDays, monthOf } from "@/lib/dates.js";

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("employeeRead");
  const q = new URL(req.url).searchParams;
  const to = q.get("to") || todayStr();
  const from = q.get("from") || addDays(to, -180);
  if (!isDay(from) || !isDay(to)) throw new GuardError(400, "A from and to date (YYYY-MM-DD) are required.");
  if (from > to) throw new GuardError(400, "The window ends before it starts.");
  const account = q.get("account") || "";

  const scope = await visibilityScope(actor);
  const where = {
    ...(scope ? { id: { in: scope } } : {}),
    ...(account ? { account } : {}),
  };

  const employees = await prisma.employee.findMany({
    where,
    select: {
      id: true, empId: true, fullNameEn: true, account: true, lob: true,
      stage: true, hireDate: true, exitDate: true, exitType: true, exitReason: true,
    },
  });
  const ids = employees.map((e) => e.id);

  const movement = waterfall(employees, from, to);
  const split = attritionSplit(employees, from, to, (reason: string) => attritionClass(reason));

  /* ── Leave liability, only for those who may see pay ──────────────────── */
  let liability = null;
  if (can({ role: actor.role }, "piiRead") && ids.length) {
    const [ledger, pay] = await Promise.all([
      prisma.leaveLedgerEntry.findMany({
        where: { employeeId: { in: ids } },
        select: { employeeId: true, type: true, days: true },
      }),
      prisma.compensationRecord.findMany({
        where: { employeeId: { in: ids }, voided: false, effectiveFrom: { lte: to } },
        orderBy: [{ effectiveFrom: "desc" }, { recordedAt: "desc" }],
        select: { employeeId: true, baseSalary: true },
      }),
    ]);

    /* First row per employee wins — the query is already ordered by effective
       date descending, so this is "in force", not "most recent by insertion". */
    const salaryOf = new Map<string, string>();
    for (const p of pay) if (!salaryOf.has(p.employeeId)) salaryOf.set(p.employeeId, String(p.baseSalary));

    const byEmployee = new Map<string, Array<{ type: string; days: unknown }>>();
    for (const l of ledger) {
      if (!byEmployee.has(l.employeeId)) byEmployee.set(l.employeeId, []);
      byEmployee.get(l.employeeId)!.push({ type: l.type, days: l.days });
    }

    liability = leaveLiability(
      employees
        /* Leavers are excluded: their balance was settled on exit, and counting
           it again would inflate the figure by everyone who has ever left. */
        .filter((e) => e.stage !== "Exited")
        .map((e) => ({
          employeeId: e.id,
          balanceDays: balanceOf((byEmployee.get(e.id) ?? []).map((x) => ({ ...x, days: Number(x.days) }))),
          monthlySalary: salaryOf.get(e.id) ?? null,
        }))
    );
  }

  /* ── Signals, for the people this actor already looks after ───────────── */
  const active = employees.filter((e) => !["Exited", "Applicant"].includes(e.stage));
  const since90 = addDays(to, -90);
  const since180 = addDays(to, -180);

  const [cases, leaveGrants, payChanges] = await Promise.all([
    prisma.case.findMany({
      where: { empId: { in: active.map((e) => e.empId) }, date: { gte: since90, lte: to }, voided: false },
      select: { empId: true, date: true, disciplinary: true },
    }),
    prisma.leaveLedgerEntry.findMany({
      where: { employeeId: { in: active.map((e) => e.id) }, type: "grant", effectiveDate: { gte: since180, lte: to } },
      select: { employeeId: true, days: true },
    }),
    prisma.compensationRecord.findMany({
      where: { employeeId: { in: active.map((e) => e.id) }, voided: false },
      orderBy: [{ effectiveFrom: "desc" }],
      select: { employeeId: true, effectiveFrom: true },
    }),
  ]);

  const casesByEmp = new Map<string, number>();
  for (const c of cases) casesByEmp.set(c.empId, (casesByEmp.get(c.empId) ?? 0) + 1);
  const leaveByEmp = new Map<string, number>();
  for (const l of leaveGrants) leaveByEmp.set(l.employeeId, (leaveByEmp.get(l.employeeId) ?? 0) + Math.abs(Number(l.days)));
  const lastPay = new Map<string, string>();
  for (const p of payChanges) if (!lastPay.has(p.employeeId)) lastPay.set(p.employeeId, p.effectiveFrom);

  const monthsBetween = (a: string, b: string) => {
    if (!a) return 0;
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return (by - ay) * 12 + (bm - am);
  };

  const risks = active
    .map((e) => ({
      employeeId: e.id,
      empId: e.empId,
      name: e.fullNameEn,
      account: e.account,
      ...flightRisk(
        {
          hireDate: e.hireDate,
          casesLast90: casesByEmp.get(e.empId) ?? 0,
          leaveDaysTakenLast180: leaveByEmp.get(e.id) ?? 0,
          monthsSincePayChange: lastPay.has(e.id) ? monthsBetween(lastPay.get(e.id)!, to) : 0,
        },
        to
      ),
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  return NextResponse.json({
    from,
    to,
    account,
    movement,
    attritionRate: attritionRate(movement),
    split,
    joinersByMonth: byMonth(
      employees.filter((e) => e.hireDate && e.hireDate >= from && e.hireDate <= to),
      monthOf(from),
      monthOf(to),
      (e: { hireDate: string }) => e.hireDate
    ),
    leaversByMonth: byMonth(
      employees.filter((e) => e.exitDate && e.exitDate >= from && e.exitDate <= to),
      monthOf(from),
      monthOf(to),
      (e: { exitDate: string }) => e.exitDate
    ),
    /* Absent, not zeroed, when the actor may not see pay. */
    liability,
    canSeePay: can({ role: actor.role }, "piiRead"),
    risks,
    population: employees.length,
  });
});

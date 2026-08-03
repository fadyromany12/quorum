/* GET /api/wfm/impact?employeeId=&from=&to=
   What approving this absence would do to cover, day by day.

   This is the question an approver has always been answering by instinct: "can
   we cover Tuesday without them". The roster already contains the person, so
   the exact answer is available — recompute cover with their rows removed.

   It is advice, never a veto. Annual leave is a statutory entitlement under
   Egyptian Labour Law No. 12/2003 and a staffing model does not get to overrule
   it; the response is deliberately shaped as sentences and a per-day verdict
   rather than a boolean an interface could wire to a disabled button. An
   approver who wants to approve an uncoverable day may, and the audit trail
   records that they saw the warning.

   Days with no forecast return "not planned" rather than "covered". Silence and
   safety are different answers, and a tool that reports an unplanned day as
   fine teaches people to trust it exactly where it knows least. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { assertVisibleEmployee } from "@/lib/employee-db";
import { planDay, checkForecast, shrinkageFrom, DEFAULT_INTERVAL } from "@/lib/wfm.js";
import { absenceImpact, shrinkageInputs } from "@/lib/schedule.js";
import { daysBetween, addDays } from "@/lib/dates.js";

/** A leave request longer than this is a sabbatical, not a shift problem. */
const MAX_DAYS = 31;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("wfmRead");
  const q = new URL(req.url).searchParams;
  const employeeId = q.get("employeeId") ?? "";
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? from;
  if (!employeeId) throw new GuardError(400, "An employee is required.");
  if (!isDay(from) || !isDay(to)) throw new GuardError(400, "A from and to date (YYYY-MM-DD) are required.");
  const span = daysBetween(from, to);
  if (span < 0) throw new GuardError(400, "The window ends before it starts.");
  if (span >= MAX_DAYS) throw new GuardError(400, `Ask for at most ${MAX_DAYS} days at a time.`);

  /* The same visibility rule as the directory: an approver may only ask about
     someone they can already see. */
  await assertVisibleEmployee(actor, employeeId);
  const subject = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, fullNameEn: true, account: true, lob: true },
  });
  if (!subject) throw new GuardError(404, "No such employee.");

  const dates: string[] = [];
  for (let i = 0; i <= span; i++) dates.push(addDays(from, i));

  const [forecasts, roster] = await Promise.all([
    prisma.forecast.findMany({
      where: { account: subject.account, lob: subject.lob, date: { in: dates } },
      orderBy: { interval: "asc" },
    }),
    prisma.scheduleEntry.findMany({
      where: { date: { in: dates }, employee: { account: subject.account, lob: subject.lob } },
      include: { pattern: { select: { paidBreakMinutes: true, unpaidBreakMinutes: true } } },
    }),
  ]);

  const days = dates.map((date) => {
    const dayForecast = forecasts.filter((f) => f.date === date);
    const dayRoster = roster
      .filter((r) => r.date === date)
      .map((r) => ({
        ...r,
        paidBreakMinutes: r.pattern?.paidBreakMinutes ?? 0,
        unpaidBreakMinutes: r.pattern?.unpaidBreakMinutes ?? 0,
      }));

    if (dayForecast.length === 0 || checkForecast(dayForecast).length > 0) {
      return {
        date,
        planned: false,
        coverable: null,
        verdict: "No forecast for this day, so there is nothing to measure it against.",
        affected: [],
        causedByThis: 0,
      };
    }

    const shrinkage = shrinkageFrom(shrinkageInputs(dayRoster)).shrinkage;
    const plan = planDay(dayForecast, { shrinkage, intervalMinutes: DEFAULT_INTERVAL });
    const impact = absenceImpact({ plan, roster: dayRoster, employeeId, width: DEFAULT_INTERVAL });
    return { date, planned: true, ...impact };
  });

  const planned = days.filter((d) => d.planned);
  const problem = planned.filter((d) => d.coverable === false);

  return NextResponse.json({
    employeeId,
    name: subject.fullNameEn,
    account: subject.account,
    lob: subject.lob,
    from,
    to,
    days,
    /* One line for the approver, honest about what it does not know. */
    headline:
      planned.length === 0
        ? "None of these days is planned yet, so cover cannot be judged."
        : problem.length === 0
          ? `Cover holds on all ${planned.length} planned day${planned.length === 1 ? "" : "s"}.`
          : `${problem.length} of ${planned.length} planned day${planned.length === 1 ? "" : "s"} would be left short: ${problem.map((d) => d.date).join(", ")}.`,
    coverable: problem.length === 0,
    plannedDays: planned.length,
    unplannedDays: days.length - planned.length,
  });
});

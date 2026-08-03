/* GET /api/wfm/schedule/swappable — my upcoming shifts, and the ones I could
   ask to trade for.

   Published only, and future only. A draft roster is one the agent is not
   supposed to be able to see yet, and a shift that has already happened cannot
   be swapped — it can only be corrected, which is a different conversation with
   a different person.

   Colleagues are limited to the same account and line of business. An agent on
   Hertz cannot work a Lenovo shift, so offering it would be offering something
   the lead would have to refuse; and the list is names and times only, which is
   what a swap needs and the whole of what it needs. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { todayStr } from "@/lib/dates.js";
import { coveringActivities } from "@/lib/schedule.js";

const NO_RECORD = "Your login is not linked to an employment record yet — HR can link it.";

export const GET = guarded(async () => {
  const actor = await requireRole(null);
  const me = await prisma.employee.findUnique({
    where: { userId: actor.id },
    select: { id: true, account: true, lob: true },
  });
  if (!me) throw new GuardError(409, NO_RECORD);

  const from = todayStr();
  const covering = coveringActivities() as string[];
  const common = {
    published: true,
    date: { gte: from },
    activity: { in: covering },
  };

  const [mine, theirs] = await Promise.all([
    prisma.scheduleEntry.findMany({
      where: { ...common, employeeId: me.id },
      orderBy: { date: "asc" },
      take: 60,
      select: { id: true, date: true, startTime: true, durationMinutes: true, activity: true },
    }),
    prisma.scheduleEntry.findMany({
      where: {
        ...common,
        employeeId: { not: me.id },
        employee: { account: me.account, ...(me.lob ? { lob: me.lob } : {}) },
      },
      orderBy: { date: "asc" },
      take: 200,
      select: {
        id: true, date: true, startTime: true, durationMinutes: true, activity: true,
        employee: { select: { fullNameEn: true } },
      },
    }),
  ]);

  return NextResponse.json({
    mine,
    theirs: theirs.map((r) => {
      const { employee, ...rest } = r;
      return { ...rest, employeeName: employee.fullNameEn };
    }),
  });
});

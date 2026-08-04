/* GET /api/me/schedule?weeks= — my own published roster.

   Separate from /api/wfm/schedule on purpose. That endpoint answers "show me
   the roster for these people in this window", which is a planning question
   gated on wfmRead and narrowed by visibility scope. This one answers "when do
   I work", takes no employee id at all, and is available to anyone with an
   employment record — including an Agent, who holds none of the WFM
   permissions and is the person the question is actually about.

   Published only. A draft is a plan; a published roster is a promise people
   arrange childcare around, and an agent seeing a draft would plan their life
   around something nobody has committed to. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { todayStr, addDays } from "@/lib/dates.js";
import { weekStart } from "@/lib/myschedule.js";

const MAX_WEEKS = 8;

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const me = await prisma.employee.findUnique({
    where: { userId: actor.id },
    select: { id: true },
  });
  if (!me) {
    throw new GuardError(409, "Your login is not linked to an employment record yet — HR can link it.");
  }

  const asked = Number(new URL(req.url).searchParams.get("weeks")) || 2;
  const weeks = Math.min(MAX_WEEKS, Math.max(1, asked));

  const today = todayStr();
  /* From the start of the current week, so the grid can show the days already
     worked this week rather than starting mid-row. */
  const from = weekStart(today) as string;
  const to = addDays(from, weeks * 7 - 1);

  const rows = await prisma.scheduleEntry.findMany({
    where: { employeeId: me.id, published: true, date: { gte: from, lte: to } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { id: true, date: true, activity: true, startTime: true, durationMinutes: true, note: true },
  });

  /* The horizon is a question about the whole published future, not about the
     window being displayed — "published to the end of next week" is the answer
     whether you are looking at two weeks or eight. */
  const furthest = await prisma.scheduleEntry.findFirst({
    where: { employeeId: me.id, published: true, date: { gte: today } },
    orderBy: { date: "desc" },
    select: { date: true },
  });

  return NextResponse.json({ from, to, today, weeks, rows, publishedTo: furthest?.date ?? null });
});

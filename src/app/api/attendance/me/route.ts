/* GET /api/attendance/me — my current state and today's shift.

   Polled by the clock, so it stays deliberately small: current state, today's
   totals, and any breaches. No history, no other people. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { myDay } from "@/lib/attendance-db";

export const GET = guarded(async () => {
  const actor = await requireRole(null);

  const me = await prisma.employee.findUnique({
    where: { userId: actor.id },
    select: { id: true, stage: true, empId: true, fullNameEn: true, preferredName: true },
  });
  if (!me) {
    throw new GuardError(409, "Your login is not linked to an employment record yet — HR can link it.");
  }

  const day = await myDay(me.id);
  return NextResponse.json({ employee: me, ...day });
});

/* GET /api/attendance/floor — who is on the floor and what they are doing.

   Scoped the same way the directory is: HR and SuperAdmin see everyone, a lead
   sees their own subtree. The scope is resolved from the session and never
   accepted from the request. */

import { NextResponse } from "next/server";
import { requireRole, guarded } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { floorView } from "@/lib/attendance-db";
import { visibilityScope } from "@/lib/employee-db";
import { isWorking, STAGES } from "@/lib/employee.js";

const WORKING_STAGES = STAGES.filter(isWorking);

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("floorView");
  const p = new URL(req.url).searchParams;
  const account = p.get("account") || undefined;

  const scope = await visibilityScope(actor);

  /* Only people who could actually be working. An exited employee in a floor
     view is noise, and one who has not started yet is confusing. */
  const people = await prisma.employee.findMany({
    where: {
      stage: { in: WORKING_STAGES as never[] },
      ...(account ? { account } : {}),
      ...(scope ? { id: { in: scope } } : {}),
    },
    select: { id: true },
  });

  const view = await floorView(people.map((e) => e.id));
  return NextResponse.json(view);
});

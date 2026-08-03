/* POST /api/requests/[id]/withdraw — take back a request you raised.

   The window is per type: pending-based for leave, a fixed number of days for a
   resignation. workflow.canWithdraw owns both shapes, and returns the reason so
   the user is told which one applies rather than just being refused. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { withdrawRequest } from "@/lib/workflow-db";
import { writeAudit } from "@/lib/db";

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 2]; // .../requests/<id>/withdraw

  const employee = await prisma.employee.findUnique({
    where: { userId: actor.id },
    select: { id: true },
  });
  if (!employee) {
    throw new GuardError(409, "Your login is not linked to an employment record yet — HR can link it.");
  }

  const result = await withdrawRequest(id, { ...actor, employeeId: employee.id });
  if (!result.ok) throw new GuardError(result.status, result.reason);

  await writeAudit({
    actor,
    action: "REQUEST_WITHDRAWN",
    summary: `${result.request.config?.label ?? result.request.type} withdrawn by the requester.`,
    meta: { requestId: id },
  });

  return NextResponse.json({ request: result.request });
});

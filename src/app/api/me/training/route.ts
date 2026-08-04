/* GET /api/me/training — my own training, and whether I can take contacts.

   The rules already existed and so did HR's screen. The gap was the direction:
   readiness was computed *about* an agent and shown to everybody except them.
   Somebody whose client certification lapses next month finds out when they are
   pulled off the account, and the app knew for six weeks.

   Takes no employee id, like /api/me/schedule, so an Agent can call it while
   holding none of the employee permissions. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { readiness, statusOf, expiresOn, requiredFor } from "@/lib/training.js";
import { TRAINING_TYPES } from "@/lib/taxonomy.js";
import { todayStr } from "@/lib/dates.js";

export const GET = guarded(async () => {
  const actor = await requireRole(null);
  const me = await prisma.employee.findUnique({
    where: { userId: actor.id },
    select: { id: true, account: true },
  });
  if (!me) {
    throw new GuardError(409, "Your login is not linked to an employment record yet — HR can link it.");
  }

  const rows = await prisma.trainingRecord.findMany({
    where: { employeeId: me.id },
    orderBy: [{ completedOn: "desc" }, { createdAt: "desc" }],
  });

  const today = todayStr();
  const records = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    status: statusOf(r, today),
    /* Computed rather than stored, so a change to a validity period applies to
       everything rather than to whatever was saved after the change. */
    expiresOn: r.completedOn ? expiresOn(r.type, r.completedOn) : "",
    label: (TRAINING_TYPES as Record<string, { label?: string }>)[r.type]?.label ?? r.type,
  }));

  return NextResponse.json({
    records,
    readiness: readiness(rows, me, today),
    required: requiredFor(me),
    types: TRAINING_TYPES,
    today,
  });
});

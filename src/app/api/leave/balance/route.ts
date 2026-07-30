/* GET /api/leave/balance — my balance, with its derivation.

   Reading brings the ledger up to date first (the accrual sweep is idempotent),
   so the number an employee sees never depends on whether a cron has run. The
   entries ride along because the balance without them is just an assertion. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { balance } from "@/lib/leave-db";

export const GET = guarded(async () => {
  const actor = await requireRole(null);
  const me = await prisma.employee.findUnique({
    where: { userId: actor.id },
    select: { id: true },
  });
  if (!me) {
    throw new GuardError(409, "Your login is not linked to an employment record yet — HR can link it.");
  }
  return NextResponse.json(await balance(me.id));
});

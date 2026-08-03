/* GET    /api/delegations — who is approving on my behalf.
   PUT    /api/delegations — set it.
   DELETE /api/delegations — end it.

   Self-service by design: an approver about to go on leave should not have to
   raise a ticket to arrange cover, because the version of that story where they
   forget is the one where a week of requests silently stall behind them. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { setDelegation, revokeDelegations, myDelegation } from "@/lib/workflow-db";
import { writeAudit } from "@/lib/db";

const NO_RECORD = "Your login is not linked to an employment record yet — HR can link it.";

async function me(userId?: string) {
  if (!userId) return null;
  return prisma.employee.findUnique({ where: { userId }, select: { id: true, fullNameEn: true } });
}

export const GET = guarded(async () => {
  const actor = await requireRole(null);
  const employee = await me(actor.id);
  if (!employee) throw new GuardError(409, NO_RECORD);
  return NextResponse.json({ delegation: await myDelegation(employee.id) });
});

export const PUT = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const employee = await me(actor.id);
  if (!employee) throw new GuardError(409, NO_RECORD);

  const body = await req.json().catch(() => ({}));
  const delegateId = String(body.delegateId ?? "");
  if (!delegateId) throw new GuardError(400, "Choose who should approve for you.");

  const result = await setDelegation(employee.id, {
    delegateId,
    from: String(body.from ?? ""),
    to: String(body.to ?? ""),
    note: String(body.note ?? ""),
  });
  if (!result.ok) throw new GuardError(result.status, result.reason);

  const delegate = await prisma.employee.findUnique({
    where: { id: delegateId },
    select: { fullNameEn: true, empId: true },
  });
  await writeAudit({
    actor,
    action: "DELEGATION_SET",
    summary:
      `${employee.fullNameEn} delegated approvals to ${delegate?.fullNameEn ?? delegateId}` +
      (result.delegation.from || result.delegation.to
        ? ` (${result.delegation.from || "now"} → ${result.delegation.to || "until revoked"}).`
        : " until revoked."),
    meta: { delegateId, from: result.delegation.from, to: result.delegation.to },
  });

  return NextResponse.json({ delegation: result.delegation });
});

export const DELETE = guarded(async () => {
  const actor = await requireRole(null);
  const employee = await me(actor.id);
  if (!employee) throw new GuardError(409, NO_RECORD);

  const { revoked } = await revokeDelegations(employee.id);
  if (revoked) {
    await writeAudit({
      actor,
      action: "DELEGATION_ENDED",
      summary: `${employee.fullNameEn} ended their approval delegation.`,
      meta: {},
    });
  }
  return NextResponse.json({ revoked });
});

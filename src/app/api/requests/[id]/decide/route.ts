/* POST /api/requests/[id]/decide — approve or reject the step waiting on you.

   Whether this actor may act is decided by the engine against the request's own
   chain and the live delegations, not by a role. That is the point of having one
   engine: an approver is whoever the chain says, plus whoever they have
   delegated to, and no endpoint gets to have its own opinion. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { decideRequest } from "@/lib/workflow-db";
import { writeAudit } from "@/lib/db";

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 2]; // .../requests/<id>/decide
  const body = await req.json().catch(() => ({}));

  const decision = String(body.decision ?? "");
  if (!["approve", "reject"].includes(decision)) {
    throw new GuardError(400, "Decision must be approve or reject.");
  }
  /* A rejection without a reason is unusable: the requester cannot fix anything,
     and nobody reviewing it later can tell whether it was considered. */
  const note = String(body.note ?? "").trim();
  if (decision === "reject" && !note) {
    throw new GuardError(400, "Say why you are rejecting it — the requester needs a reason.");
  }

  const employee = await prisma.employee.findUnique({
    where: { userId: actor.id },
    select: { id: true },
  });
  if (!employee) {
    throw new GuardError(409, "Your login is not linked to an employment record yet — HR can link it.");
  }

  const result = await decideRequest(
    id,
    {
      decision: decision as "approve" | "reject",
      grantedUnits: body.grantedUnits == null ? undefined : Number(body.grantedUnits),
      proposedValue: body.proposedValue == null ? undefined : String(body.proposedValue),
      note,
    },
    { ...actor, employeeId: employee.id },
  );
  if (!result.ok) throw new GuardError(result.status, result.reason);

  const r = result.request;
  await writeAudit({
    actor,
    action: decision === "approve" ? "REQUEST_APPROVED" : "REQUEST_REJECTED",
    summary:
      `${r.config?.label ?? r.type} for ${r.subject?.fullNameEn ?? r.subjectId}: ${decision}d` +
      (result.viaDelegation ? " (as a delegate)" : "") +
      ` — now ${r.status}.`,
    meta: { requestId: r.id, status: r.status, grantedUnits: r.grantedUnits, viaDelegation: result.viaDelegation },
  });

  return NextResponse.json({ request: r });
});

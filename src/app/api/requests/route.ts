/* GET  /api/requests?view=inbox|mine — what is waiting on me, or my own history.
   POST /api/requests — raise one.

   No permission gate beyond being signed in with an employment record: whether
   this actor may raise this type about this subject is a question about the
   subject's reporting lines, not about a role, and workflow.canRaise answers it. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { inbox, myRequests, raiseRequest, canRaise } from "@/lib/workflow-db";
import { writeAudit } from "@/lib/db";
import { subordinateIds } from "@/lib/employee.js";
import { REQUEST_TYPES } from "@/lib/workflow.js";

/** The actor's employment record — every request question is asked about it. */
async function me(userId?: string) {
  if (!userId) return null;
  return prisma.employee.findUnique({
    where: { userId },
    select: { id: true, fullNameEn: true, empId: true, stage: true },
  });
}

const NO_RECORD = "Your login is not linked to an employment record yet — HR can link it.";

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const employee = await me(actor.id);
  if (!employee) throw new GuardError(409, NO_RECORD);

  const view = new URL(req.url).searchParams.get("view") || "mine";
  if (view === "inbox") {
    return NextResponse.json({ items: await inbox(employee.id) });
  }
  return NextResponse.json({ requests: await myRequests(employee.id) });
});

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const employee = await me(actor.id);
  if (!employee) throw new GuardError(409, NO_RECORD);

  const body = await req.json().catch(() => ({}));
  const type = String(body.type ?? "");
  const cfg = REQUEST_TYPES[type as keyof typeof REQUEST_TYPES];
  if (!cfg) throw new GuardError(400, `Unknown request type "${type}".`);

  const subjectId = body.subjectId ? String(body.subjectId) : employee.id;

  /* Reporting lines decide who may raise what, so the subordinate set is
     resolved here rather than trusted from the request. */
  const graph = await prisma.employee.findMany({ select: { id: true, directManagerId: true } });
  const permitted = canRaise(type, {
    actorId: employee.id,
    actorRole: actor.role,
    subjectId,
    subordinateIds: subordinateIds(employee.id, graph),
  });
  if (!permitted.ok) throw new GuardError(403, permitted.reason);

  /* Partial-capable types are measured in units, and a request for none of
     something is not a request. */
  let requestedUnits: number | null = null;
  if (cfg.partial) {
    requestedUnits = Number(body.requestedUnits);
    if (!Number.isFinite(requestedUnits) || requestedUnits <= 0) {
      throw new GuardError(400, `How many ${cfg.unit}? Enter a number greater than zero.`);
    }
  }

  // Co-approval needs the requester's proposal up front: it is both what the
  // approvers are agreeing on and the default if they never agree.
  const proposedValue = String(body.proposedValue ?? "");
  if (cfg.chain === "coApproval" && !proposedValue) {
    throw new GuardError(400, `Propose a ${cfg.agreeOn}.`);
  }

  const result = await raiseRequest(
    { type, subjectId, payload: body.payload ?? {}, requestedUnits, proposedValue },
    { ...actor, employeeId: employee.id },
  );
  if (!result.ok) throw new GuardError(result.status, result.reason);

  await writeAudit({
    actor,
    action: "REQUEST_RAISED",
    summary: `${cfg.label} raised for ${result.request.subject?.fullNameEn ?? subjectId}.`,
    meta: { requestId: result.request.id, type, subjectId },
  });

  return NextResponse.json({ request: result.request }, { status: 201 });
});

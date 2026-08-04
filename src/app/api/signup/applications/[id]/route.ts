/* POST /api/signup/applications/[id] — approve or decline an application.

   The one endpoint in the app that turns a disabled login into a working one,
   so the authority check is by name rather than by role: whether this actor is
   the manager the application was addressed to. That lives in signup.js and is
   re-checked inside the transaction, because two managers clicking at once
   must not produce two approvals. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { decideApplication } from "@/lib/signup-db";
import { SIGNUP_DECISIONS } from "@/lib/signup.js";

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const id = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  const body = await req.json().catch(() => ({}));

  const decision = String(body.decision ?? "");
  if (!SIGNUP_DECISIONS.includes(decision)) throw new GuardError(400, "Decision must be approve or reject.");

  /* Declining somebody is a thing they may ask about years later, and "no"
     with no reason attached is unanswerable. */
  const note = String(body.note ?? "").trim();
  if (decision === "reject" && !note) {
    throw new GuardError(400, "Say why you are declining it — this stays on their record.");
  }

  const employee = await prisma.employee.findUnique({
    where: { userId: actor.id },
    select: { id: true },
  });

  const result = await decideApplication(
    id,
    decision as "approve" | "reject",
    { id: actor.id, name: actor.name, role: actor.role, employeeId: employee?.id ?? null },
    note,
  );

  return NextResponse.json(result);
});

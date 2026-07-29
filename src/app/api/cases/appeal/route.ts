/* POST /api/cases/appeal — an agent contests a finalized disciplinary case.

   One appeal per case: it flips appealState to "pending" and records the
   agent's reason. HR/PM resolve it via /api/cases/appeal/resolve. */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole("acknowledge"); // Agent only

  const body = await req.json().catch(() => ({}));
  const caseId = String(body.caseId || "");
  const reason = String(body.reason || "").trim();

  if (!caseId) throw new GuardError(400, "caseId is required.");
  if (reason.length < 10) throw new GuardError(400, "Give a reason of at least 10 characters for your appeal.");

  const row = await prisma.case.findUnique({ where: { id: caseId } });
  if (!row) throw new GuardError(404, "Case not found.");

  const me = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!me) throw new GuardError(401, "Not signed in.");
  const owns =
    (row.empId && me.empId && row.empId.toLowerCase() === me.empId.toLowerCase()) ||
    (row.email && me.email && row.email.toLowerCase() === me.email.toLowerCase());
  if (!owns) throw new GuardError(403, "This case does not belong to you.");

  if (!row.disciplinary) throw new GuardError(400, "Only disciplinary cases can be appealed.");
  if (row.voided) throw new GuardError(400, "This case has been voided.");
  if (row.stage !== "active") throw new GuardError(400, "Only a finalized case can be appealed.");
  if (row.appealState) throw new GuardError(409, "This case has already been appealed.");

  const now = new Date();
  const activity = Array.isArray(row.activity) ? row.activity : [];

  await prisma.$transaction([
    prisma.case.update({
      where: { id: caseId },
      data: {
        appealState: "pending",
        appealReason: reason,
        appealAt: now,
        activity: [...activity, { at: now.getTime(), by: me.name, type: "appeal_submitted", text: reason }],
      },
    }),
    prisma.auditLog.create({
      data: {
        actorId: me.id,
        actorName: me.name,
        actorRole: me.role,
        action: "APPEAL_SUBMITTED",
        caseId,
        summary: `${me.name} appealed "${row.action}" for ${row.violation} (${row.date}).`,
        meta: { reason, violation: row.violation, caseDate: row.date },
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
});

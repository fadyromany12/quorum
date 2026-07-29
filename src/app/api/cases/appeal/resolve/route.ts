/* POST /api/cases/appeal/resolve — HR or a Project Manager rules on an appeal.

   "overturned" dismisses the case (it stops counting and its deduction is
   freed via the normal re-settlement); "upheld" leaves the action in force.
   Both outcomes are audited and stamped on the case timeline. */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { can } from "@/lib/auth.js";
import { loadEntries, syncEntries, writeAudit, type Entry } from "@/lib/db";

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  if (!can({ role: actor.role }, "hr") && !can({ role: actor.role }, "triage")) {
    throw new GuardError(403, "Only HR or a Project Manager can rule on an appeal.");
  }

  const body = await req.json().catch(() => ({}));
  const caseId = String(body.caseId || "");
  const decision = body.decision === "overturned" ? "overturned" : body.decision === "upheld" ? "upheld" : null;
  const note = String(body.note || "").trim();
  if (!caseId || !decision) throw new GuardError(400, "caseId and a decision (upheld | overturned) are required.");

  const before = await loadEntries();
  const existing = before.find((e) => e.id === caseId);
  if (!existing) throw new GuardError(404, "Case not found.");
  if (existing.appealState !== "pending") throw new GuardError(409, "There is no pending appeal on this case.");

  const now = Date.now();
  const text =
    decision === "overturned"
      ? `Appeal granted — the disciplinary case is overturned and dismissed.${note ? ` ${note}` : ""}`
      : `Appeal reviewed — the original decision stands.${note ? ` ${note}` : ""}`;

  // Appeal metadata lives outside the engine's field set, so write it directly.
  await prisma.case.update({
    where: { id: caseId },
    data: { appealState: decision, appealNote: note, appealResolvedAt: new Date(now) },
  });

  // Overturn dismisses the case so it stops counting and re-settles deductions;
  // upholding just records the outcome on the timeline. Either way the activity
  // stamp goes through the engine writer.
  const after: Entry[] = before.map((e) =>
    e.id === caseId
      ? {
          ...e,
          stage: decision === "overturned" ? "dismissed" : e.stage,
          activity: [...((e.activity as unknown[]) || []), { at: now, by: actor.name, type: "appeal_resolved", text }],
        }
      : e
  );
  const entries = await syncEntries(before, after);

  await writeAudit({
    actor,
    action: "APPEAL_RESOLVED",
    summary: `${actor.name} ${decision} the appeal on ${existing.violation} (${existing.date}).`,
    caseId,
    meta: { decision, note, violation: existing.violation },
  });

  return NextResponse.json({ entries });
});

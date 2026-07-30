/* POST /api/employees/[id]/stage — advance someone's lifecycle stage.

   The only way a stage changes. Validity is decided by the pure state machine
   in employee.js, so "Exited employee quietly set back to Active" is impossible
   rather than merely discouraged, and the change plus its timeline row commit
   together. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { transitionStage } from "@/lib/employee-db";
import { writeAudit } from "@/lib/db";
import { isStage } from "@/lib/employee.js";
import { EXIT_TYPE_CODES, EXIT_REASONS, exitReasonsFor } from "@/lib/taxonomy.js";

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole("lifecycle");
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 2]; // .../employees/<id>/stage
  const body = await req.json().catch(() => ({}));

  const to = String(body.stage ?? "");
  if (!isStage(to)) throw new GuardError(400, `Unknown stage "${to}".`);

  /* An exit without a type or a date is an incomplete record that someone has
     to reconstruct later from memory. Require both at the point of the change. */
  const exitType = body.exitType ? String(body.exitType) : "";
  const exitReason = body.exitReason ? String(body.exitReason) : "";
  if (to === "Exited") {
    if (!exitType || !EXIT_TYPE_CODES.includes(exitType)) {
      throw new GuardError(400, `An exit needs a type: ${EXIT_TYPE_CODES.join(", ")}.`);
    }
    if (!body.effectiveDate) throw new GuardError(400, "An exit needs a last working day.");

    /* A coded reason, checked against the type. Free text made attrition
       unreportable — "better offer" and "Better pay" counted as two causes with
       one occurrence each. And a reason from the wrong type produces a record
       that contradicts itself: a resignation for gross misconduct. */
    const allowed = exitReasonsFor(exitType);
    if (!exitReason) {
      throw new GuardError(400, `An exit needs a reason. For ${exitType}: ${allowed.join(", ")}.`);
    }
    if (!allowed.includes(exitReason)) {
      const known = EXIT_REASONS[exitReason];
      throw new GuardError(
        400,
        known
          ? `"${known.label}" is a reason for ${known.exitType}, not ${exitType}.`
          : `Unknown exit reason "${exitReason}".`,
      );
    }
  }

  const result = await transitionStage(id, to, actor, {
    effectiveDate: String(body.effectiveDate ?? ""),
    detail: String(body.detail ?? ""),
    exitType,
    exitReason,
    exitNote: String(body.exitNote ?? ""),
  });
  if (!result.ok) throw new GuardError(result.status, result.reason);

  await writeAudit({
    actor,
    action: "EMPLOYEE_STAGE_CHANGED",
    summary: `${result.employee.fullNameEn} (${result.employee.empId}): ${result.event.fromVal} → ${to}.`,
    meta: {
      employeeId: id, from: result.event.fromVal, to,
      ...(to === "Exited"
        ? { exitType, exitReason, attrition: EXIT_REASONS[exitReason]?.rehireEligible === false ? "no-rehire" : "rehire-ok" }
        : {}),
    },
  });

  return NextResponse.json({ employee: result.employee });
});

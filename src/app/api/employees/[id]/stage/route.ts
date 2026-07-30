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

const EXIT_TYPES = ["Resignation", "Termination", "EndOfContract", "Retirement", "Abandonment"];

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
  if (to === "Exited") {
    if (!exitType || !EXIT_TYPES.includes(exitType)) {
      throw new GuardError(400, `An exit needs a type: ${EXIT_TYPES.join(", ")}.`);
    }
    if (!body.effectiveDate) throw new GuardError(400, "An exit needs a last working day.");
  }

  const result = await transitionStage(id, to, actor, {
    effectiveDate: String(body.effectiveDate ?? ""),
    detail: String(body.detail ?? ""),
    exitType,
    exitReason: String(body.exitReason ?? ""),
  });
  if (!result.ok) throw new GuardError(result.status, result.reason);

  await writeAudit({
    actor,
    action: "EMPLOYEE_STAGE_CHANGED",
    summary: `${result.employee.fullNameEn} (${result.employee.empId}): ${result.event.fromVal} → ${to}.`,
    meta: { employeeId: id, from: result.event.fromVal, to },
  });

  return NextResponse.json({ employee: result.employee });
});

/* GET   /api/employees/[id] — one profile, plus its timeline.
   PATCH /api/employees/[id] — edit attributes (never the lifecycle stage).

   Visibility is checked against the same pure function the directory uses, so a
   record that is filtered out of the list cannot be fetched directly by id. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { getEmployee, getTimeline, updateEmployee, assertVisibleEmployee as assertVisible } from "@/lib/employee-db";
import { writeAudit } from "@/lib/db";

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("employeeRead");
  const id = new URL(req.url).pathname.split("/").filter(Boolean).pop() as string;

  await assertVisible(actor, id);

  const employee = await getEmployee(id);
  if (!employee) throw new GuardError(404, "No such employee.");

  const timeline = await getTimeline(id);
  return NextResponse.json({ employee, timeline });
});

export const PATCH = guarded(async (req: Request) => {
  const actor = await requireRole("employeeWrite");
  const id = new URL(req.url).pathname.split("/").filter(Boolean).pop() as string;
  const body = await req.json().catch(() => ({}));

  const result = await updateEmployee(id, body, actor);
  if (!result.ok) throw new GuardError(result.status, result.reason);

  await writeAudit({
    actor,
    action: "EMPLOYEE_UPDATED",
    summary: `Updated ${result.employee.fullNameEn} (${result.employee.empId}).`,
    meta: { employeeId: id, timelineEvents: result.events.map((e) => e.type) },
  });

  return NextResponse.json({ employee: result.employee });
});

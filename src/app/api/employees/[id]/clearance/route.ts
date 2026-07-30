/* GET  /api/employees/[id]/clearance — the checklist.
   POST — complete one step {key, note?}.

   Steps are created lazily on first read for an exiting employee, so an exit
   recorded before this feature existed still gets a checklist. Dependency
   gating lives in the pure rules; the route only persists the outcome. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";
import { DEFAULT_CLEARANCE, canComplete, allDone } from "@/lib/clearance.js";

const idFrom = (req: Request) => {
  const p = new URL(req.url).pathname.split("/").filter(Boolean);
  return p[p.length - 2];
};

async function ensureSteps(employeeId: string) {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, stage: true, fullNameEn: true, empId: true },
  });
  if (!emp) return null;
  // Clearance exists only for people actually leaving or gone.
  if (!["Notice", "Exited"].includes(emp.stage)) return { emp, steps: [] };
  const existing = await prisma.clearanceStep.count({ where: { employeeId } });
  if (!existing) {
    await prisma.clearanceStep.createMany({
      data: DEFAULT_CLEARANCE.map((s) => ({ employeeId, ...s })),
      skipDuplicates: true,
    });
  }
  const steps = await prisma.clearanceStep.findMany({
    where: { employeeId },
    orderBy: { key: "asc" },
  });
  return { emp, steps };
}

export const GET = guarded(async (req: Request) => {
  await requireRole("employeeRead");
  const r = await ensureSteps(idFrom(req));
  if (!r) throw new GuardError(404, "No such employee.");
  return NextResponse.json({ steps: r.steps, complete: allDone(r.steps) });
});

export const POST = guarded(async (req: Request) => {
  // Broader than lifecycle on purpose: IT, facilities and finance tick their
  // own steps. Attribution is what keeps that honest.
  const actor = await requireRole("employeeRead");
  const id = idFrom(req);
  const body = await req.json().catch(() => ({}));
  const key = String(body.key ?? "");

  const r = await ensureSteps(id);
  if (!r) throw new GuardError(404, "No such employee.");
  if (!r.steps.length) throw new GuardError(409, "Clearance opens when an exit is recorded.");

  const check = canComplete(r.steps, key);
  if (!check.ok) throw new GuardError(409, check.reason);

  await prisma.clearanceStep.update({
    where: { employeeId_key: { employeeId: id, key } },
    data: { state: "done", doneByName: actor.name, doneAt: new Date(), note: String(body.note ?? "") },
  });

  const steps = await prisma.clearanceStep.findMany({ where: { employeeId: id }, orderBy: { key: "asc" } });
  const complete = allDone(steps);

  await writeAudit({
    actor,
    action: "CLEARANCE_STEP_DONE",
    summary: `${r.emp.fullNameEn} (${r.emp.empId}): "${r.steps.find((s) => s.key === key)?.label}" completed${complete ? " — clearance closed" : ""}.`,
    meta: { employeeId: id, key, complete },
  });

  if (complete) {
    await prisma.employeeEvent.create({
      data: {
        employeeId: id, type: "NOTE", title: "Clearance completed",
        detail: "Every clearance step signed off.", actorName: actor.name, actorRole: actor.role,
      },
    });
  }
  return NextResponse.json({ steps, complete });
});

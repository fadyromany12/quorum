/* GET  /api/employees/[id]/training — what this person has been trained on.
   POST — record or update one course {type, state, plannedOn?, completedOn?, …}.

   The rules live in training.js; this route persists the outcome and writes the
   timeline row. Expiry is never stored — it is derived on read, so the answer is
   right whether or not the nightly sweep has run. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";
import { assertVisibleEmployee } from "@/lib/employee-db";
import { checkRecord, summarise, statusOf, expiresOn } from "@/lib/training.js";
import { TRAINING_TYPES } from "@/lib/taxonomy.js";

const idFrom = (req: Request) => {
  const p = new URL(req.url).pathname.split("/").filter(Boolean);
  return p[p.length - 2]; // .../employees/<id>/training
};

/** The employee fields the rules need — the account decides what is required. */
const SUBJECT = { id: true, account: true, fullNameEn: true, empId: true } as const;

/** Rows plus everything derived from them, so no caller recomputes expiry. */
function decorate(rows: Array<{ type: string; state: string; completedOn: string }>) {
  return rows.map((r) => ({
    ...r,
    status: statusOf(r),
    expiresOn: expiresOn(r.type, r.completedOn),
    label: TRAINING_TYPES[r.type]?.label ?? r.type,
    blocksProduction: !!TRAINING_TYPES[r.type]?.blocksProduction,
  }));
}

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("employeeRead");
  const id = idFrom(req);
  await assertVisibleEmployee(actor, id);

  const employee = await prisma.employee.findUnique({ where: { id }, select: SUBJECT });
  if (!employee) throw new GuardError(404, "No such employee.");

  const rows = await prisma.trainingRecord.findMany({
    where: { employeeId: id },
    orderBy: [{ completedOn: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({
    records: decorate(rows),
    ...summarise(rows, employee),
  });
});

export const POST = guarded(async (req: Request) => {
  /* Deliberately wider than `lifecycle`: training is recorded by the training
     function and by team leads, not only by HR. Attribution is what keeps that
     honest — every row carries who set it. */
  const actor = await requireRole("employeeRead");
  const id = idFrom(req);
  await assertVisibleEmployee(actor, id);

  const employee = await prisma.employee.findUnique({ where: { id }, select: SUBJECT });
  if (!employee) throw new GuardError(404, "No such employee.");

  const body = await req.json().catch(() => ({}));
  const input = {
    type: String(body.type ?? ""),
    state: String(body.state ?? "planned"),
    plannedOn: String(body.plannedOn ?? ""),
    completedOn: String(body.completedOn ?? ""),
  };

  const check = checkRecord(input);
  if (!check.ok) throw new GuardError(400, check.reason);

  const data = {
    ...input,
    score: String(body.score ?? ""),
    provider: String(body.provider ?? ""),
    note: String(body.note ?? ""),
    actorName: actor.name,
    actorRole: actor.role,
  };

  /* One live record per person per course: a retake supersedes rather than
     duplicating, so "is this person certified" has exactly one answer. The
     superseded attempt is not lost — the timeline below keeps it. */
  const row = await prisma.trainingRecord.upsert({
    where: { employeeId_type: { employeeId: id, type: input.type } },
    create: { employeeId: id, ...data },
    update: data,
  });

  const label = TRAINING_TYPES[input.type]?.label ?? input.type;
  if (input.state === "completed") {
    await prisma.employeeEvent.create({
      data: {
        employeeId: id,
        type: "TRAINING_COMPLETED",
        title: `${label} completed`,
        detail: [data.provider, data.score].filter(Boolean).join(" · "),
        at: new Date(),
        actorName: actor.name,
        actorRole: actor.role,
      },
    });
  }

  await writeAudit({
    actor,
    action: "TRAINING_RECORDED",
    summary: `${employee.fullNameEn} (${employee.empId}): ${label} — ${input.state}.`,
    meta: { employeeId: id, type: input.type, state: input.state },
  });

  const rows = await prisma.trainingRecord.findMany({ where: { employeeId: id } });
  return NextResponse.json({ record: row, ...summarise(rows, employee) });
});

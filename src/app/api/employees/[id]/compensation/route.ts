/* GET  /api/employees/[id]/compensation — this person's salary history.
   POST — record a new salary, effective from a date.

   Append-only and effective-dated. A salary is never edited: a correction is a
   new version, and a version entered in error is voided rather than deleted.
   That is not bureaucracy — "what were they earning last March" is a question
   payroll, an auditor and a labour court all ask, and a table that overwrites
   cannot answer it at all.

   Behind piiWrite, the same permission as an IBAN. What someone is paid is not
   management information; it is the fact most likely to be misused if it
   travels further than it needs to. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";
import { assertVisibleEmployee, writeEvent } from "@/lib/employee-db";
import { toMinor, fromMinor, formatMinor, changePct, checkPayChange, PAY_REASONS } from "@/lib/comp.js";

const idFrom = (req: Request) => {
  const p = new URL(req.url).pathname.split("/").filter(Boolean);
  return p[p.length - 2]; // .../employees/<id>/compensation
};

/** comp.js exports these as plain strings; the route only needs membership. */
const REASONS = new Set(PAY_REASONS as string[]);

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("piiRead");
  const id = idFrom(req);
  await assertVisibleEmployee(actor, id);

  const rows = await prisma.compensationRecord.findMany({
    where: { employeeId: id },
    orderBy: [{ effectiveFrom: "desc" }, { recordedAt: "desc" }],
  });

  /* Decimal → minor units → grouped string, through the money helpers rather
     than by multiplying a float. The percentage change is against the previous
     *live* version, so a voided row in between does not distort it. */
  const live = rows.filter((r) => !r.voided);
  const decorated = rows.map((r) => {
    const minor = toMinor(String(r.baseSalary)) ?? 0;
    const i = live.findIndex((l) => l.id === r.id);
    const prev = i >= 0 && i + 1 < live.length ? toMinor(String(live[i + 1].baseSalary)) : null;
    return {
      id: r.id,
      effectiveFrom: r.effectiveFrom,
      recordedAt: r.recordedAt,
      amount: fromMinor(minor),
      display: formatMinor(minor),
      currency: r.currency,
      reason: r.reason,
      note: r.note,
      voided: r.voided,
      actorName: r.actorName,
      changePct: prev === null ? null : changePct(prev, minor),
    };
  });

  const current = decorated.find((r) => !r.voided) ?? null;
  return NextResponse.json({ records: decorated, current, reasons: PAY_REASONS });
});

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole("piiWrite");
  const id = idFrom(req);
  await assertVisibleEmployee(actor, id);

  const employee = await prisma.employee.findUnique({
    where: { id },
    select: { id: true, empId: true, fullNameEn: true },
  });
  if (!employee) throw new GuardError(404, "No such employee.");

  const body = await req.json().catch(() => ({}));
  const minor = toMinor(body.amount);
  if (minor === null || minor <= 0) throw new GuardError(400, "Enter a salary as a number, e.g. 9000 or 9000.50.");
  const effectiveFrom = String(body.effectiveFrom ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new GuardError(400, "An effective date (YYYY-MM-DD) is required.");
  const reason = String(body.reason ?? "");
  if (!REASONS.has(reason)) throw new GuardError(400, `"${reason}" is not a reason this system records.`);

  const previous = await prisma.compensationRecord.findFirst({
    where: { employeeId: id, voided: false },
    orderBy: [{ effectiveFrom: "desc" }, { recordedAt: "desc" }],
  });
  const previousMinor = previous ? toMinor(String(previous.baseSalary)) : null;

  /* The pure policy check — a cut without a reason that permits one, a change
     of an implausible size, a date before the last one. It lives in comp.js so
     the form and the API agree. */
  const check = checkPayChange(
    { baseSalary: body.amount, currency: String(body.currency ?? "EGP"), reason, effectiveFrom },
    { previousMinor }
  );
  if (!check.ok) throw new GuardError(400, check.reason);

  const created = await prisma.compensationRecord.create({
    data: {
      employeeId: id,
      effectiveFrom,
      baseSalary: fromMinor(minor),
      currency: String(body.currency ?? "EGP"),
      reason: reason as never,
      note: String(body.note ?? "").slice(0, 500),
      actorName: actor.name,
      actorRole: actor.role,
    },
  });

  const pct = previousMinor === null ? null : changePct(previousMinor, minor);
  const summary =
    previousMinor === null
      ? `Salary set for ${employee.fullNameEn}: ${formatMinor(minor)} from ${effectiveFrom}`
      : `Salary for ${employee.fullNameEn} changed from ${formatMinor(previousMinor)} to ${formatMinor(minor)}${pct === null ? "" : ` (${pct > 0 ? "+" : ""}${pct}%)`} from ${effectiveFrom}`;

  /* Both the timeline and the audit log. The timeline is the employee's own
     story; the audit log is the system's. They answer different questions and
     writing to only one always turns out to be the wrong one. */
  await writeEvent(id, {
    type: "COMPENSATION",
    title: previousMinor === null ? "Salary recorded" : "Salary changed",
    detail: summary,
    fromVal: previousMinor === null ? "" : formatMinor(previousMinor),
    toVal: formatMinor(minor),
    effectiveDate: effectiveFrom,
    actorName: actor.name,
    actorRole: actor.role,
  });
  await writeAudit({
    actor,
    action: "COMPENSATION_RECORDED",
    summary,
    meta: { employeeId: id, effectiveFrom, reason, changePct: pct, recordId: created.id },
  });

  return NextResponse.json({ ok: true, id: created.id });
});

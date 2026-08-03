/* GET/POST/DELETE /api/wfm/patterns — the named shift shapes a roster is built
   from ("Early 8-4", "Split 10-7").

   Patterns exist so a schedule is assembled by choosing a shape rather than
   typing two times four hundred times, and so changing a shift's break
   structure is one edit rather than four hundred.

   Deleting one never touches the rosters built from it. ScheduleEntry copies
   the hours and holds the pattern only as a nullable reference, so a retired
   pattern leaves last month's published shifts exactly as they were worked. A
   pattern is a template, and deleting a template has never been a reason to
   rewrite history. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";
import { minutesOf } from "@/lib/schedule.js";

export const GET = guarded(async () => {
  await requireRole("wfmRead");
  const patterns = await prisma.shiftPattern.findMany({
    orderBy: [{ active: "desc" }, { startTime: "asc" }],
  });
  return NextResponse.json({ patterns });
});

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole("wfmWrite");
  const b = (await req.json()) as Record<string, unknown>;

  const name = String(b.name ?? "").trim();
  const startTime = String(b.startTime ?? "").trim();
  const durationMinutes = Math.round(Number(b.durationMinutes) || 0);
  const paidBreakMinutes = Math.max(0, Math.round(Number(b.paidBreakMinutes) || 0));
  const unpaidBreakMinutes = Math.max(0, Math.round(Number(b.unpaidBreakMinutes) || 0));

  if (!name) throw new GuardError(400, "A pattern needs a name people will recognise on a roster.");
  if (!Number.isFinite(minutesOf(startTime))) throw new GuardError(400, "The start time is not a clock time.");
  if (durationMinutes <= 0) throw new GuardError(400, "The shift has no length.");
  if (durationMinutes > 16 * 60) throw new GuardError(400, "The shift is longer than 16 hours — check the units are minutes.");
  if (paidBreakMinutes + unpaidBreakMinutes >= durationMinutes) throw new GuardError(400, "The breaks are longer than the shift.");

  const data = {
    name,
    account: String(b.account ?? "").trim(),
    lob: String(b.lob ?? "").trim(),
    startTime,
    durationMinutes,
    paidBreakMinutes,
    unpaidBreakMinutes,
    active: b.active === undefined ? true : !!b.active,
  };

  const id = String(b.id ?? "");
  /* The name is unique so a roster can name a shape unambiguously. A second
     pattern called "Early 8-4" is a person re-adding one they already have,
     which deserves a sentence rather than a 500 and a stack trace in the log. */
  const clash = await prisma.shiftPattern.findFirst({
    where: { name, ...(id ? { NOT: { id } } : {}) },
    select: { id: true, startTime: true, durationMinutes: true },
  });
  if (clash) {
    throw new GuardError(
      409,
      `A pattern called "${name}" already exists (${clash.startTime}, ${Math.round((clash.durationMinutes / 60) * 10) / 10}h). Edit that one, or give this a different name.`
    );
  }

  const pattern = id
    ? await prisma.shiftPattern.update({ where: { id }, data })
    : await prisma.shiftPattern.create({ data });

  await writeAudit({
    actor,
    action: id ? "SHIFT_PATTERN_UPDATED" : "SHIFT_PATTERN_CREATED",
    summary: `${id ? "Updated" : "Created"} shift pattern "${name}" (${startTime}, ${Math.round(durationMinutes / 60 * 10) / 10}h)`,
    meta: { ...data, id: pattern.id },
  });
  return NextResponse.json({ pattern });
});

export const DELETE = guarded(async (req: Request) => {
  const actor = await requireRole("wfmWrite");
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) throw new GuardError(400, "An id is required.");

  const pattern = await prisma.shiftPattern.findUnique({ where: { id } });
  if (!pattern) throw new GuardError(404, "No such pattern.");

  /* Deactivate rather than delete once it has been used. The rows keep their
     own hours either way, but a named reference on a published roster is worth
     more than a tidy table — "Early 8-4" tells a lead what was planned, and a
     dangling null does not. */
  const used = await prisma.scheduleEntry.count({ where: { patternId: id } });
  if (used > 0) {
    await prisma.shiftPattern.update({ where: { id }, data: { active: false } });
    await writeAudit({
      actor,
      action: "SHIFT_PATTERN_RETIRED",
      summary: `Retired shift pattern "${pattern.name}" — kept because ${used} roster row${used === 1 ? "" : "s"} name it`,
      meta: { id, name: pattern.name, usedBy: used },
    });
    return NextResponse.json({ ok: true, retired: true, usedBy: used });
  }

  await prisma.shiftPattern.delete({ where: { id } });
  await writeAudit({
    actor,
    action: "SHIFT_PATTERN_DELETED",
    summary: `Deleted unused shift pattern "${pattern.name}"`,
    meta: { id, name: pattern.name },
  });
  return NextResponse.json({ ok: true, retired: false });
});

/* GET  /api/wfm/schedule?from=&to=&account=&lob=  — the roster for a window.
   POST /api/wfm/schedule  — write rows {rows:[…], publish?:boolean}.
   DELETE ?id=  — remove one row.

   Two rules the rest of this file exists to keep:

     1. A schedule is only visible to whoever may see the person. A lead
        planning their own team must not learn the whole floor's shift pattern
        by asking for a wide date range, so every read and every write is
        narrowed by the same visibility scope the directory uses.

     2. Publishing is a separate, deliberate act. A roster an agent can see is
        one they will plan their life around — childcare, a second job, a
        commute — so a draft is invisible until someone publishes it, and the
        act is audited with the window it covered. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";
import { visibilityScope } from "@/lib/employee-db";
import { checkEntry, findClashes, SCHEDULE_ACTIVITIES } from "@/lib/schedule.js";
import { daysBetween } from "@/lib/dates.js";

/** schedule.js is plain JS on purpose (the agent portal imports it too), so the
    activity map has no index signature here. The lookup is a display label
    falling back to the stored code, which is exactly what an unknown code
    should render as. */
const activityLabel = (code: string) =>
  (SCHEDULE_ACTIVITIES as Record<string, { label: string } | undefined>)[code]?.label ?? code;


/** A window wide enough to plan a quarter, narrow enough that one request
    cannot pull the whole history of the floor. */
const MAX_WINDOW_DAYS = 120;
const isDay = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));

type Row = {
  id?: string;
  employeeId?: string;
  date?: string;
  activity?: string;
  startTime?: string;
  durationMinutes?: number;
  patternId?: string | null;
  note?: string;
};

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("wfmRead");
  const q = new URL(req.url).searchParams;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? from;
  if (!isDay(from) || !isDay(to)) throw new GuardError(400, "A from and to date (YYYY-MM-DD) are required.");
  const span = daysBetween(from, to);
  if (span < 0) throw new GuardError(400, "The window ends before it starts.");
  if (span > MAX_WINDOW_DAYS) throw new GuardError(400, `Ask for at most ${MAX_WINDOW_DAYS} days at a time.`);

  const account = q.get("account") ?? "";
  const lob = q.get("lob") ?? "";
  const scope = await visibilityScope(actor);

  const rows = await prisma.scheduleEntry.findMany({
    where: {
      date: { gte: from, lte: to },
      ...(scope ? { employeeId: { in: scope } } : {}),
      ...(account || lob ? { employee: { ...(account ? { account } : {}), ...(lob ? { lob } : {}) } } : {}),
    },
    include: {
      employee: { select: { id: true, empId: true, fullNameEn: true, account: true, lob: true } },
      pattern: { select: { id: true, name: true, paidBreakMinutes: true, unpaidBreakMinutes: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  return NextResponse.json({ from, to, rows, clashes: findClashes(rows) });
});

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole("scheduleWrite");
  const body = (await req.json()) as { rows?: Row[]; publish?: boolean };
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) throw new GuardError(400, "No rows were sent.");
  if (rows.length > 500) throw new GuardError(400, "Send at most 500 rows at a time.");

  /* Validate the whole batch first. A half-written roster is worse than a
     rejected one — it publishes a day that is short by however many rows
     failed, and nothing on screen says so. */
  const problems: string[] = [];
  for (const r of rows) {
    for (const p of checkEntry(r)) problems.push(`${r.date ?? "?"}: ${p}`);
  }
  if (problems.length) throw new GuardError(400, problems.slice(0, 5).join(" "));

  const ids = [...new Set(rows.map((r) => String(r.employeeId)))];
  const scope = await visibilityScope(actor);
  if (scope) {
    const allowed = new Set(scope);
    const outside = ids.filter((id) => !allowed.has(id));
    if (outside.length) throw new GuardError(403, `${outside.length} of these people are outside your teams.`);
  }
  const known = await prisma.employee.count({ where: { id: { in: ids } } });
  if (known !== ids.length) throw new GuardError(400, "Some rows point at people who do not exist.");

  /* Breaks are the pattern's, so a row built from one carries its structure
     without duplicating it. A row with no pattern is an ad-hoc shift and
     carries none — its coverage is then its full duration, which is correct for
     a two-hour overtime block and wrong for nothing. */
  const written = await prisma.$transaction(
    rows.map((r) =>
      prisma.scheduleEntry.upsert({
        where: {
          employeeId_date_startTime: {
            employeeId: String(r.employeeId),
            date: String(r.date),
            startTime: String(r.startTime ?? ""),
          },
        },
        create: {
          employeeId: String(r.employeeId),
          date: String(r.date),
          activity: String(r.activity ?? "Shift"),
          startTime: String(r.startTime ?? ""),
          durationMinutes: Math.round(Number(r.durationMinutes) || 0),
          patternId: r.patternId ?? null,
          published: !!body.publish,
          note: String(r.note ?? ""),
          actorName: actor.name,
          actorRole: actor.role,
        },
        update: {
          activity: String(r.activity ?? "Shift"),
          durationMinutes: Math.round(Number(r.durationMinutes) || 0),
          patternId: r.patternId ?? null,
          ...(body.publish ? { published: true } : {}),
          note: String(r.note ?? ""),
          actorName: actor.name,
          actorRole: actor.role,
        },
      })
    )
  );

  const dates = [...new Set(written.map((w) => w.date))].sort();
  await writeAudit({
    actor,
    action: body.publish ? "SCHEDULE_PUBLISHED" : "SCHEDULE_SAVED",
    summary: `${body.publish ? "Published" : "Saved"} ${written.length} roster row${written.length === 1 ? "" : "s"} for ${
      dates.length === 1 ? dates[0] : `${dates[0]} – ${dates[dates.length - 1]}`
    }`,
    meta: {
      rows: written.length,
      people: ids.length,
      from: dates[0],
      to: dates[dates.length - 1],
      activities: [...new Set(written.map((w) => w.activity))],
    },
  });

  return NextResponse.json({ ok: true, written: written.length, published: !!body.publish });
});

export const DELETE = guarded(async (req: Request) => {
  const actor = await requireRole("scheduleWrite");
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) throw new GuardError(400, "An id is required.");

  const row = await prisma.scheduleEntry.findUnique({
    where: { id },
    include: { employee: { select: { id: true, fullNameEn: true } } },
  });
  if (!row) throw new GuardError(404, "No such roster row.");

  const scope = await visibilityScope(actor);
  if (scope && !scope.includes(row.employeeId)) throw new GuardError(403, "That person is outside your teams.");

  await prisma.scheduleEntry.delete({ where: { id } });
  await writeAudit({
    actor,
    action: "SCHEDULE_REMOVED",
    summary: `Removed ${activityLabel(row.activity)} on ${row.date} for ${row.employee.fullNameEn}`,
    meta: { employeeId: row.employeeId, date: row.date, activity: row.activity, published: row.published },
  });
  return NextResponse.json({ ok: true });
});

/* GET /api/attendance/exceptions?date=yyyy-mm-dd — where the roster and the
   clock disagreed on one day, for everyone the caller may see.

   This is the join nobody wants to do by eye. The roster says who should have
   been on the floor, the punch stream says who was, the leave ledger says who
   was excused, and until now comparing the three meant a lead opening two
   screens and a spreadsheet, or waiting for the RTA import to land the next
   morning.

   All three inputs are loaded before anything is classified, and the classifier
   is given the approved leave explicitly rather than being allowed to assume its
   absence. That is the difference between a correct NCNS and an accusation
   against someone who filed leave three weeks ago — see exceptions.js, which
   refuses to judge a missing day it has not been told about.

   Read-only. It proposes cases; it does not open them. */

import { NextResponse } from "next/server";
import { requireRole, guarded } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { visibilityScope } from "@/lib/employee-db";
import { intervals as toIntervals, ordered, localDay } from "@/lib/attendance.js";
import { exceptionsFor, rankExceptions, summariseDay, shiftWindow, DEFAULT_TZ } from "@/lib/exceptions.js";
import { todayStr } from "@/lib/dates.js";

const TZ = DEFAULT_TZ;

export const GET = guarded(async (req: Request) => {
  /* `floorView` rather than `employeeRead`: this is an operational screen about
     attendance, and the roles that watch the floor are the roles that should
     see where it went wrong. */
  const actor = await requireRole("floorView");
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || todayStr();
  const account = url.searchParams.get("account") || "";

  const scope = await visibilityScope(actor);

  const people = await prisma.employee.findMany({
    where: {
      ...(scope ? { id: { in: scope } } : {}),
      ...(account && account !== "All" ? { account } : {}),
      stage: { in: ["Active", "Probation", "OnPip", "Notice"] },
    },
    select: { id: true, empId: true, fullNameEn: true, account: true, lob: true },
  });
  const ids = people.map((p) => p.id);
  if (!ids.length) return NextResponse.json({ date, rows: [], summary: summariseDay([]), people: 0 });

  /* The day's three sources, in parallel. The punch window is widened by a day
     on each side so an overnight shift's punches are not cut in half by the
     calendar. */
  const [schedule, events, leave] = await Promise.all([
    prisma.scheduleEntry.findMany({
      where: { employeeId: { in: ids }, date },
      select: { employeeId: true, activity: true, startTime: true, durationMinutes: true },
    }),
    prisma.attendanceEvent.findMany({
      where: {
        employeeId: { in: ids },
        at: { gte: new Date(Date.parse(`${date}T00:00:00Z`) - 36 * 3600_000), lte: new Date(Date.parse(`${date}T00:00:00Z`) + 60 * 3600_000) },
      },
      select: { employeeId: true, type: true, aux: true, at: true },
      orderBy: { at: "asc" },
    }),
    /* Approved leave overlapping the day. Settled and not rejected — the same
       records the employee's own balance is derived from. */
    prisma.request.findMany({
      where: { type: "leave", subjectId: { in: ids }, settledAt: { not: null } },
      select: { subjectId: true, payload: true, settledAt: true },
    }),
  ]);

  const byEmployee = <T extends { employeeId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.employeeId, [...(m.get(r.employeeId) ?? []), r]);
    return m;
  };
  const scheduleBy = new Map(schedule.map((s) => [s.employeeId, s]));
  const eventsBy = byEmployee(events);
  const leaveBy = new Map<string, Array<{ from: string; to: string }>>();
  for (const r of leave) {
    const p = (r.payload ?? {}) as { from?: string; to?: string };
    if (!p.from || !p.to) continue;
    leaveBy.set(r.subjectId, [...(leaveBy.get(r.subjectId) ?? []), { from: p.from, to: p.to }]);
  }

  const now = Date.now();
  const rows: Array<Record<string, unknown>> = [];
  const undetermined: Array<{ employeeId: string; name: string; reason: string }> = [];

  for (const p of people) {
    const sched = scheduleBy.get(p.id) ?? null;
    const evs = ordered((eventsBy.get(p.id) ?? []).map((e) => ({ ...e, at: e.at.getTime() })));
    /* Only the intervals that fall on this local day — the widened punch window
       exists to complete an overnight shift, not to import the neighbouring
       one. */
    const dayIntervals = toIntervals(evs, now).filter((i: { from: number }) => localDay(i.from, TZ) === date);

    const result = exceptionsFor({
      date,
      scheduled: sched,
      shift: sched?.startTime ? shiftWindow(date, sched.startTime, sched.durationMinutes) : null,
      intervals: dayIntervals,
      approvedLeave: leaveBy.get(p.id) ?? [],
      nowMs: now,
    });

    for (const e of result.exceptions) {
      rows.push({
        ...e,
        employeeId: p.id,
        employeeName: p.fullNameEn,
        empId: p.empId,
        account: p.account,
        lob: p.lob,
      });
    }
    for (const reason of result.undetermined) {
      undetermined.push({ employeeId: p.id, name: p.fullNameEn, reason });
    }
  }

  const ranked = rankExceptions(rows as never[]);
  return NextResponse.json({
    date,
    rows: ranked,
    summary: summariseDay(ranked as never[]),
    /* How many people were examined, so "3 exceptions" can be read against
       "of 47 scheduled" rather than floating free. */
    people: people.length,
    /* Surfaced rather than swallowed: a day the engine could not judge is a gap
       in the roster, and the lead is the person who can close it. */
    undetermined: undetermined.slice(0, 50),
  });
});

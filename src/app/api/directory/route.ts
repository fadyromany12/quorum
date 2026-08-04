/* GET /api/directory — who is here, who is on, who is away.

   The employee directory already exists and answers "tell me about this
   person". This answers the questions people actually open a directory for on
   a working day: who is on shift right now, who is off this week, and how do I
   reach them.

   Deliberately thin on the record and rich on the day. No salary, no
   identifiers, no case history — a directory that carries those is an
   employee record with a friendlier name, and it would then need the same
   permission the employee record has, which would put it out of reach of the
   people who need a phone number.

   That is why this is the one people-shaped endpoint an Agent can call. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { todayStr, addDays } from "@/lib/dates.js";
import { coveringActivities } from "@/lib/schedule.js";

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const me = await prisma.employee.findUnique({
    where: { userId: actor.id },
    select: { id: true, account: true },
  });
  if (!me) {
    throw new GuardError(409, "Your login is not linked to an employment record yet — HR can link it.");
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const account = url.searchParams.get("account") ?? "";
  const today = todayStr();
  const weekEnd = addDays(today, 6);

  const people = await prisma.employee.findMany({
    where: {
      // People who are actually here. An applicant is not somebody you ring,
      // and a leaver's extension belongs to whoever has it now.
      stage: { in: ["Probation", "Active", "OnPip", "Notice"] },
      ...(account ? { account } : {}),
      ...(q
        ? {
            OR: [
              { fullNameEn: { contains: q, mode: "insensitive" as const } },
              { preferredName: { contains: q, mode: "insensitive" as const } },
              { jobTitle: { contains: q, mode: "insensitive" as const } },
              { empId: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    // Work contact only. Personal email, phone and address are not directory
    // data — a colleague needs to reach you at work, not at home.
    select: {
      id: true, empId: true, fullNameEn: true, fullNameAr: true, preferredName: true,
      jobTitle: true, department: true, account: true, lob: true, workSite: true,
      workEmail: true, stage: true, directManagerId: true,
    },
    orderBy: { fullNameEn: "asc" },
    take: 300,
  });

  const ids = people.map((p) => p.id);

  /* Three cheap facts about today, fetched once for everybody rather than
     per row. Whether somebody is reachable right now is the whole reason a
     directory gets opened. */
  const [onShift, away, punched] = await Promise.all([
    prisma.scheduleEntry.findMany({
      where: { employeeId: { in: ids }, date: today, published: true, activity: { in: coveringActivities() as string[] } },
      select: { employeeId: true, startTime: true, durationMinutes: true },
    }),
    prisma.scheduleEntry.findMany({
      where: { employeeId: { in: ids }, date: { gte: today, lte: weekEnd }, published: true, activity: "Leave" },
      select: { employeeId: true, date: true },
    }),
    prisma.attendanceEvent.findMany({
      where: { employeeId: { in: ids }, at: { gte: new Date(`${today}T00:00:00.000Z`) } },
      select: { employeeId: true, type: true, at: true },
      orderBy: { at: "asc" },
    }),
  ]);

  const shiftBy = new Map(onShift.map((s) => [s.employeeId, s]));
  const awayBy = new Map<string, string[]>();
  for (const a of away) {
    if (!awayBy.has(a.employeeId)) awayBy.set(a.employeeId, []);
    awayBy.get(a.employeeId)!.push(a.date);
  }
  /* Last punch wins: LOGIN then LOGOUT means they have gone home, and the two
     rows are otherwise indistinguishable from being on a break. */
  const liveBy = new Map<string, string>();
  for (const p of punched) liveBy.set(p.employeeId, p.type);

  const byId = new Map(people.map((p) => [p.id, p]));

  return NextResponse.json({
    people: people.map((p) => {
      const shift = shiftBy.get(p.id);
      const leaveDays = awayBy.get(p.id) ?? [];
      const manager = p.directManagerId ? byId.get(p.directManagerId) : null;
      return {
        ...p,
        name: p.preferredName || p.fullNameEn,
        managerName: manager ? manager.preferredName || manager.fullNameEn : "",
        shift: shift ? { startTime: shift.startTime, durationMinutes: shift.durationMinutes } : null,
        /* On leave today is a different answer from on leave on Thursday, and
           somebody deciding whether to ring needs the first one. */
        onLeaveToday: leaveDays.includes(today),
        awayThisWeek: leaveDays.sort(),
        loggedIn: liveBy.get(p.id) === "LOGIN" || liveBy.get(p.id) === "AUX",
      };
    }),
    accounts: [...new Set(people.map((p) => p.account).filter(Boolean))].sort(),
    today,
    me: me.id,
  });
});

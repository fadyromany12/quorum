/* Attendance persistence. The rules live in attendance.js; this is the only
   place that talks to Postgres about punches.

   Two invariants:

   1. **The server stamps the time.** `at` is never taken from the request. A
      client clock can be wrong by hours and can be set deliberately, and an
      agent who can choose their own punch time can choose their own adherence.

   2. **Append only.** There is no update path and no status column. Current
      state is derived from the event stream, so concurrent punches cannot
      corrupt each other — at shift change that is hundreds of agents writing
      inside the same minute. */

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  checkPunch, currentState, intervals, summarise, breaches, adherence,
  staleSession, localDay, shiftsByDay, ATTENDANCE_POLICY, DEFAULT_AUX,
} from "./attendance.js";

export type Actor = { id?: string; name: string; role: string };
export type Punch = { type: "LOGIN" | "LOGOUT" | "AUX"; aux?: string; note?: string; source?: string };

/* How far back to read when deriving current state.
   Bounded on purpose: a year of punches is tens of thousands of rows and the
   answer only ever depends on the current session. Two days covers the longest
   overnight shift plus the abandoned-session ceiling with room to spare. */
const STATE_LOOKBACK_HOURS = 48;

const toEvent = (r: { id: string; at: Date; type: string; aux: string; source: string; note: string }) => ({
  id: r.id,
  at: r.at.getTime(),
  type: r.type,
  aux: r.aux || undefined,
  source: r.source,
  note: r.note,
});

/** Recent events for one employee, oldest first. */
export async function recentEvents(employeeId: string, hours = STATE_LOOKBACK_HOURS) {
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await prisma.attendanceEvent.findMany({
    where: { employeeId, at: { gte: since } },
    orderBy: { at: "asc" },
    select: { id: true, at: true, type: true, aux: true, source: true, note: true },
  });
  return rows.map(toEvent);
}

/** Every event whose session could still be open, for the sweeper. */
export async function openSessionEvents(hours = STATE_LOOKBACK_HOURS) {
  const since = new Date(Date.now() - hours * 3_600_000);
  const rows = await prisma.attendanceEvent.findMany({
    where: { at: { gte: since } },
    orderBy: { at: "asc" },
    select: { id: true, at: true, type: true, aux: true, source: true, note: true, employeeId: true },
  });
  const byEmployee = new Map<string, ReturnType<typeof toEvent>[]>();
  for (const r of rows) {
    if (!byEmployee.has(r.employeeId)) byEmployee.set(r.employeeId, []);
    byEmployee.get(r.employeeId)!.push(toEvent(r));
  }
  return byEmployee;
}

/**
 * Record a punch.
 *
 * Validation runs against the freshly-read stream, and the returned
 * `duplicate` case writes nothing — a double-tap or a retried request is not an
 * error, and inserting a second identical event would corrupt the very timings
 * it is meant to record.
 */
export async function punch(
  employeeId: string,
  p: Punch,
  actor: Actor,
  opts: { forSelf?: boolean } = {},
) {
  const nowMs = Date.now(); // server time, always
  const events = await recentEvents(employeeId);

  const check = checkPunch(events, p, nowMs);
  if (!check.ok) return { ok: false as const, status: 409, reason: check.reason };
  if (check.duplicate) {
    return { ok: true as const, duplicate: true, state: currentState(events, nowMs) };
  }

  const source = p.source && ["agent", "supervisor", "system"].includes(p.source)
    ? p.source
    : opts.forSelf === false ? "supervisor" : "agent";

  const created = await prisma.attendanceEvent.create({
    data: {
      employeeId,
      at: new Date(nowMs),
      type: p.type as Prisma.AttendanceEventCreateInput["type"],
      // A LOGIN with no explicit state lands in the default; a LOGOUT carries none.
      aux: p.type === "LOGOUT" ? "" : p.aux || (p.type === "LOGIN" ? DEFAULT_AUX : ""),
      source,
      note: String(p.note ?? ""),
      actorName: actor.name,
      actorRole: actor.role,
    },
    select: { id: true, at: true, type: true, aux: true, source: true, note: true },
  });

  const after = [...events, toEvent(created)];
  return { ok: true as const, duplicate: false, event: toEvent(created), state: currentState(after, nowMs) };
}

/**
 * One employee's live state plus today's shift, as the agent clock needs it.
 *
 * `shift` is the scheduled window when one is known; adherence is null without
 * it rather than a made-up percentage.
 */
export async function myDay(employeeId: string, shift?: { start: number; end: number } | null) {
  const nowMs = Date.now();
  const events = await recentEvents(employeeId);
  const state = currentState(events, nowMs);
  const all = intervals(events, nowMs);

  // Today's shift only — keyed on session start, so an overnight shift that
  // began yesterday evening still belongs to yesterday.
  const today = localDay(nowMs);
  const byDay = shiftsByDay(all);
  const todays = byDay.get(today) ?? [];

  return {
    now: nowMs,
    today,
    state,
    summary: summarise(todays),
    breaches: breaches(todays),
    adherence: shift ? adherence(todays, shift) : null,
    intervals: todays,
  };
}

/**
 * The floor: everyone a supervisor can see, and what they are doing right now.
 *
 * One query for the whole scope rather than a query per agent — a floor view
 * refreshing every few seconds over two hundred agents is exactly where an N+1
 * becomes an outage.
 */
export async function floorView(employeeIds: string[]) {
  const nowMs = Date.now();
  if (!employeeIds.length) return { now: nowMs, agents: [] };

  const since = new Date(nowMs - STATE_LOOKBACK_HOURS * 3_600_000);
  const [people, rows] = await Promise.all([
    prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, empId: true, fullNameEn: true, preferredName: true, account: true, lob: true },
    }),
    prisma.attendanceEvent.findMany({
      where: { employeeId: { in: employeeIds }, at: { gte: since } },
      orderBy: { at: "asc" },
      select: { id: true, at: true, type: true, aux: true, source: true, note: true, employeeId: true },
    }),
  ]);

  const byEmployee = new Map<string, ReturnType<typeof toEvent>[]>();
  for (const r of rows) {
    if (!byEmployee.has(r.employeeId)) byEmployee.set(r.employeeId, []);
    byEmployee.get(r.employeeId)!.push(toEvent(r));
  }

  const today = localDay(nowMs);
  const agents = people.map((p) => {
    const evs = byEmployee.get(p.id) ?? [];
    const state = currentState(evs, nowMs);
    const todays = shiftsByDay(intervals(evs, nowMs)).get(today) ?? [];
    return {
      ...p,
      state,
      summary: summarise(todays),
      breaches: breaches(todays),
    };
  });

  /* Ordered by what needs attention: anyone in breach first, then whoever has
     been in one state longest — a supervisor scanning this wants the outliers at
     the top, not an alphabetical list. */
  agents.sort((a, b) => {
    const ab = b.breaches.length - a.breaches.length;
    if (ab !== 0) return ab;
    return (b.state.seconds ?? 0) - (a.state.seconds ?? 0);
  });

  return { now: nowMs, agents };
}

/**
 * Close sessions left open past the ceiling.
 *
 * Idempotent, and safe to run twice: it re-reads state each time and only acts
 * on sessions still open. The logout is stamped at the session's deadline rather
 * than at the moment this runs, so how long an agent appears to have worked does
 * not depend on cron timing — a job that fires late must not pay them for its
 * own delay.
 */
export async function sweepStaleSessions(policy = ATTENDANCE_POLICY) {
  const nowMs = Date.now();
  const byEmployee = await openSessionEvents();
  const closed: Array<{ employeeId: string; logoutAt: number; openSeconds: number }> = [];

  for (const [employeeId, events] of byEmployee) {
    const stale = staleSession(events, nowMs, policy);
    if (!stale.stale) continue;
    await prisma.attendanceEvent.create({
      data: {
        employeeId,
        at: new Date(stale.logoutAt),
        type: "LOGOUT",
        aux: "",
        source: "system",
        note: `Session open ${Math.round(stale.openSeconds / 3600)}h — closed automatically at the ${
          Math.round(policy.maxSessionSeconds / 3600)}h limit.`,
        actorName: "system",
        actorRole: "System",
      },
    });
    closed.push({ employeeId, logoutAt: stale.logoutAt, openSeconds: stale.openSeconds });
  }

  return { swept: closed.length, closed };
}

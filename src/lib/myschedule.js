/* My schedule — the question this app could not answer.

   Rosters have been in the database for a while. WFM plans them, leads publish
   them, the swap screen reads them, the floor view compares against them. The
   one person who could not see one was the person working it: an agent opening
   the portal could clock in, book leave, read a payslip and ask to swap a shift
   they had no way to look at.

   "When do I work next" is the reason a shift worker opens an app at all, and
   it was the single thing missing.

   ── Three distinctions this file exists to keep ────────────────────────────

   1. A day with no row is not a day off. `Off` is a row on purpose — the
      schema says so — because "nobody has scheduled them" and "they are off"
      are different states and only the first is a mistake. Collapsing them
      into a blank square tells an agent they are free on a day the roster
      simply has not been written for, and they find out otherwise when
      somebody rings.

   2. Only published rows exist. A draft is a plan; a published roster is a
      promise about specific hours, which people arrange childcare and second
      jobs around. Nothing here ever reads an unpublished row — the route
      filters it, and this module would have no way to tell.

   3. A shift is a span, not a start time. Night shifts cross midnight, and a
      list that shows "22:00" without "→ 06:00" makes the reader do the
      arithmetic that the bug lives in. */

import { addDays, parseDay, todayStr } from "./dates.js";
import { SCHEDULE_ACTIVITIES, minutesOf } from "./schedule.js";

/* Saturday. Egypt's working week runs Sunday to Thursday for most of the BPO
   floor, which makes Saturday the natural left edge of a printed week — Friday
   lands at the right where the weekend belongs, rather than splitting it. */
export const WEEK_STARTS_ON = 6; // 0 = Sunday … 6 = Saturday

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Day of week for a yyyy-mm-dd string, 0 = Sunday. */
export function dayOfWeek(date) {
  const t = parseDay(date);
  return Number.isNaN(t) ? null : new Date(t).getUTCDay();
}

/** The Saturday on or before `date`. */
export function weekStart(date, startsOn = WEEK_STARTS_ON) {
  const dow = dayOfWeek(date);
  if (dow === null) return null;
  return addDays(date, -((dow - startsOn + 7) % 7));
}

/** "22:00" + 480 → "06:00". Wraps, because night shifts do. */
export function endTime(startTime, durationMinutes) {
  const start = minutesOf(startTime);
  if (Number.isNaN(start) || !durationMinutes) return "";
  const end = (start + Number(durationMinutes)) % 1440;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

/** Does this shift run past midnight into the next day? */
export const crossesMidnight = (startTime, durationMinutes) =>
  minutesOf(startTime) + Number(durationMinutes || 0) > 1440;

/**
 * One row, described the way a person would say it.
 * Returns null rather than a half-filled object for a row with no times — an
 * all-day activity like Leave has none, and inventing "00:00 → 00:00" is worse
 * than saying nothing.
 */
export function describeShift(row = {}) {
  const meta = SCHEDULE_ACTIVITIES[row.activity] ?? null;
  const label = meta?.label ?? row.activity ?? "Shift";
  const start = String(row.startTime ?? "");
  const mins = Number(row.durationMinutes ?? 0);
  if (!start || !mins) return { label, meta, span: "", hours: 0, overnight: false };
  return {
    label,
    meta,
    span: `${start} → ${endTime(start, mins)}`,
    hours: Math.round((mins / 60) * 10) / 10,
    overnight: crossesMidnight(start, mins),
  };
}

/**
 * The week grid, with every day present.
 *
 * Days the roster does not cover come back as `state: "unscheduled"` rather
 * than being absent, which is the whole point — see distinction 1 above.
 *
 * @param {Array<object>} rows published schedule entries
 * @param {{from: string, weeks?: number, today?: string}} opts
 */
export function buildWeeks(rows = [], { from = todayStr(), weeks = 2, today = todayStr() } = {}) {
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  }

  const start = weekStart(from);
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      const entries = byDate.get(date) ?? [];
      const off = entries.some((e) => e.activity === "Off");
      days.push({
        date,
        dow: dayOfWeek(date),
        dayName: DAY_SHORT[dayOfWeek(date)],
        isToday: date === today,
        isPast: date < today,
        entries: entries.map((e) => ({ ...e, ...describeShift(e) })),
        /* Three states, not two. */
        state: entries.length === 0 ? "unscheduled" : off ? "off" : "working",
        hours: entries.reduce((n, e) => n + (SCHEDULE_ACTIVITIES[e.activity]?.paid ? Number(e.durationMinutes || 0) : 0), 0) / 60,
      });
    }
    out.push({
      start: days[0].date,
      end: days[6].date,
      days,
      /* Paid hours, so a week of training still reads as a full week and a week
         of days off does not. */
      hours: Math.round(days.reduce((n, d) => n + d.hours, 0) * 10) / 10,
      working: days.filter((d) => d.state === "working").length,
      unscheduled: days.filter((d) => d.state === "unscheduled" && !d.isPast).length,
    });
  }
  return out;
}

/**
 * The next shift, and how far away it is.
 *
 * Only covering activities count — a Meeting is on the roster but it is not
 * the answer to "when do I work next". Returns null when the published roster
 * runs out, which is a real answer and the one worth showing loudly: it means
 * nobody has published past today.
 *
 * @param {Array<object>} rows
 * @param {{now?: number, today?: string}} opts
 */
export function nextShift(rows = [], { now = Date.now(), today = todayStr() } = {}) {
  const upcoming = rows
    .filter((r) => SCHEDULE_ACTIVITIES[r.activity]?.covers)
    .filter((r) => {
      if (r.date > today) return true;
      if (r.date < today) return false;
      /* Today's shift is still "next" until it has started. Once it has, the
         agent is on it and the question has a different answer. */
      const start = parseDay(r.date) + minutesOf(r.startTime) * 60000;
      return start > now;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.startTime).localeCompare(String(b.startTime)));

  const row = upcoming[0];
  if (!row) return null;

  const startsAt = parseDay(row.date) + minutesOf(row.startTime) * 60000;
  const inMinutes = Math.round((startsAt - now) / 60000);
  return {
    ...row,
    ...describeShift(row),
    startsAt,
    inMinutes,
    when: row.date === today ? "today" : row.date === addDays(today, 1) ? "tomorrow" : row.date,
  };
}

/** "in 3 hours", "in 2 days" — the phrasing a person would use out loud. */
export function untilText(inMinutes) {
  if (inMinutes == null) return "";
  if (inMinutes < 60) return `in ${Math.max(1, inMinutes)} min`;
  const hours = Math.round(inMinutes / 60);
  if (hours < 24) return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * How far the published roster reaches, and whether that is far enough.
 *
 * A roster published only to the end of this week is a real operational
 * problem for anyone arranging childcare, and it is invisible unless something
 * says so. Two weeks is the threshold because that is the notice most people
 * need to change anything.
 */
export function horizon(rows = [], { today = todayStr(), expect = 14 } = {}) {
  const future = rows.map((r) => r.date).filter((d) => d >= today).sort();
  const last = future[future.length - 1] ?? null;
  if (!last) return { last: null, days: 0, short: true, message: "No shifts have been published for you yet. Your lead publishes the roster." };
  const days = Math.round((parseDay(last) - parseDay(today)) / 86400000);
  return {
    last,
    days,
    short: days < expect,
    message: days < expect
      ? `Published up to ${last} — ${days} ${days === 1 ? "day" : "days"} ahead. Ask your lead if you need to plan further out.`
      : null,
  };
}

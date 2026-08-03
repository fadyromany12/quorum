/* Login / logout / AUX tracking.

   The cases that matter are the ones a mutable-status implementation gets wrong:
   a duplicate punch, a re-selected state resetting its own timer, an overnight
   shift splitting at midnight, a DST boundary, and an abandoned session whose
   closing time depends on when a cron happened to run. */

const A = await import("../src/lib/attendance.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

// A shift on 2026-03-10, built from instants. 09:00 Cairo = 07:00Z (no DST in March).
const T0 = Date.UTC(2026, 2, 10, 7, 0, 0);
const mins = (n) => n * 60_000;
const hrs = (n) => n * 3_600_000;
let seq = 0;
const ev = (type, offsetMs, aux) => ({ id: `e${++seq}`, type, at: T0 + offsetMs, ...(aux ? { aux } : {}) });

/* A clean 8-hour shift: login, two breaks, a lunch, a meeting, logout. */
const SHIFT = [
  ev("LOGIN", 0),
  ev("AUX", hrs(2), "Break"),
  ev("AUX", hrs(2) + mins(15), "Available"),
  ev("AUX", hrs(4), "Lunch"),
  ev("AUX", hrs(4) + mins(30), "Available"),
  ev("AUX", hrs(6), "Meeting"),
  ev("AUX", hrs(6) + mins(30), "Available"),
  ev("AUX", hrs(7), "Break"),
  ev("AUX", hrs(7) + mins(15), "Available"),
  ev("LOGOUT", hrs(8)),
];
const AFTER = T0 + hrs(9);

console.log("\n── Current state ──");
eq("no events means logged out", A.currentState([], AFTER).loggedIn, false);
eq("after logout, logged out", A.currentState(SHIFT, AFTER).loggedIn, false);
eq("logout clears the aux state", A.currentState(SHIFT, AFTER).aux, null);
{
  const mid = [ev("LOGIN", 0), ev("AUX", hrs(1), "Break")];
  const now = T0 + hrs(1) + mins(10);
  const s = A.currentState(mid, now);
  eq("open session is logged in", s.loggedIn, true);
  eq("current aux is reported", s.aux, "Break");
  eq("elapsed in state, in seconds", s.seconds, 600);
  eq("session start is the login", s.sessionStart, T0);
}
eq("login lands in Available by default", A.currentState([ev("LOGIN", 0)], T0 + mins(1)).aux, "Available");
eq("login may specify a starting state",
  A.currentState([{ id: "x", type: "LOGIN", at: T0, aux: "Training" }], T0 + mins(1)).aux, "Training");

console.log("\n── A second LOGIN must not restart the session ──");
{
  // Honouring it would silently discard the time already accrued.
  const dbl = [ev("LOGIN", 0), ev("LOGIN", hrs(3))];
  eq("session start stays the first login", A.currentState(dbl, T0 + hrs(4)).sessionStart, T0);
}

console.log("\n── Re-selecting a state must not reset its timer ──");
{
  // Otherwise an agent sits on Break forever by re-clicking Break.
  const nudged = [ev("LOGIN", 0), ev("AUX", mins(10), "Break"), ev("AUX", mins(20), "Break")];
  const s = A.currentState(nudged, T0 + mins(25));
  eq("elapsed measured from the first entry", s.seconds, 900);
  eq("and it is still one interval", A.intervals(nudged, T0 + mins(25)).filter((i) => i.aux === "Break").length, 1);
}

console.log("\n── Intervals ──");
{
  const list = A.intervals(SHIFT, AFTER);
  eq("no open interval after logout", list.some((i) => i.open), false);
  eq("interval count", list.length, 9);
  eq("every interval belongs to the session", list.every((i) => i.sessionStart === T0), true);
  eq("total equals the session length", list.reduce((s, i) => s + i.seconds, 0), 8 * 3600);
  eq("no gaps: each interval starts where the last ended",
    list.every((i, n) => n === 0 || i.from === list[n - 1].to), true);
}
{
  const open = [ev("LOGIN", 0), ev("AUX", hrs(1), "Break")];
  const list = A.intervals(open, T0 + hrs(1) + mins(5));
  eq("open session yields an open final interval", list[list.length - 1].open, true);
  eq("open interval is measured to now", list[list.length - 1].seconds, 300);
}
eq("an AUX before login is ignored", A.intervals([ev("AUX", 0, "Break"), ev("LOGIN", mins(5))], T0 + mins(10)).length, 1);
eq("a LOGOUT with no session is ignored", A.intervals([ev("LOGOUT", 0)], T0 + mins(1)), []);
eq("an unknown aux code is ignored", A.intervals([ev("LOGIN", 0), ev("AUX", mins(5), "Nonsense")], T0 + mins(10)).length, 1);
eq("unsorted input still resolves",
  A.intervals([SHIFT[3], SHIFT[0], SHIFT[1], SHIFT[2]], T0 + hrs(5)).length, 4);

console.log("\n── Tally and summary ──");
{
  const s = A.summarise(A.intervals(SHIFT, AFTER));
  eq("logged-in time", s.loggedInSeconds, 8 * 3600);
  eq("break time totals both breaks", s.byAux.Break, 1800);
  eq("lunch", s.byAux.Lunch, 1800);
  eq("meeting", s.byAux.Meeting, 1800);
  // Available = 8h minus 30m break, 30m lunch, 30m meeting.
  eq("available", s.byAux.Available, 8 * 3600 - 5400);
  // Lunch is unpaid: reporting logged-in time as hours worked overstates payroll.
  eq("paid excludes lunch", s.paidSeconds, 8 * 3600 - 1800);
  eq("unpaid is exactly lunch", s.unpaidSeconds, 1800);
  eq("productive is Available only here", s.productiveSeconds, 8 * 3600 - 5400);
  eq("occupancy", s.occupancyPct, Math.round(((8 * 3600 - 5400) / (8 * 3600)) * 1000) / 10);
  eq("codes never used are absent, not zero", Object.hasOwn(s.byAux, "Coaching"), false);
}
eq("an empty shift is 0%, not NaN", A.summarise([]).occupancyPct, 0);

console.log("\n── Punch validation ──");
eq("login when out is allowed", A.checkPunch([], { type: "LOGIN" }, T0), { ok: true });
eq("login when already in is refused",
  A.checkPunch([ev("LOGIN", 0)], { type: "LOGIN" }, T0 + hrs(1)),
  { ok: false, reason: "You are already logged in." });
eq("logout when out is refused",
  A.checkPunch([], { type: "LOGOUT" }, T0), { ok: false, reason: "You are not logged in." });
eq("aux while logged out is refused",
  A.checkPunch([], { type: "AUX", aux: "Break" }, T0),
  { ok: false, reason: "Log in before changing your state." });
eq("an unknown aux is refused",
  A.checkPunch([ev("LOGIN", 0)], { type: "AUX", aux: "Nap" }, T0 + hrs(1)),
  { ok: false, reason: 'Unknown state "Nap".' });
eq("an unknown punch type is refused",
  A.checkPunch([], { type: "TELEPORT" }, T0), { ok: false, reason: "Unknown punch type." });
eq("a valid aux change is allowed",
  A.checkPunch([ev("LOGIN", 0)], { type: "AUX", aux: "Break" }, T0 + hrs(1)), { ok: true });

console.log("\n── Idempotency, not errors ──");
{
  // A double-tap or a retried request is not the agent doing something wrong.
  // Answering 400 to it trains people to punch twice.
  const e = [{ id: "a", type: "LOGIN", at: T0 }];
  eq("an identical punch inside the window is a duplicate",
    A.checkPunch(e, { type: "LOGIN" }, T0 + 2000), { ok: true, duplicate: true });
  eq("and outside the window it is a real conflict",
    A.checkPunch(e, { type: "LOGIN" }, T0 + 60_000).ok, false);
}
eq("selecting the state you are already in is a duplicate",
  A.checkPunch([ev("LOGIN", 0), ev("AUX", hrs(1), "Break")], { type: "AUX", aux: "Break" }, T0 + hrs(2)),
  { ok: true, duplicate: true });
{
  const e = [{ id: "a", type: "AUX", at: T0, aux: "Break" }, { id: "b", type: "LOGIN", at: T0 - 1000 }];
  eq("a different aux inside the window is not a duplicate",
    A.checkPunch(e, { type: "AUX", aux: "Lunch" }, T0 + 2000), { ok: true });
}

console.log("\n── Break compliance ──");
{
  const over = [
    ev("LOGIN", 0),
    ev("AUX", hrs(1), "Break"),
    ev("AUX", hrs(1) + mins(28), "Available"), // 28 min against a 15 min limit
    ev("LOGOUT", hrs(8)),
  ];
  const b = A.breaches(A.intervals(over, AFTER));
  eq("an over-limit break is reported", b.length, 1);
  eq("with the overrun quantified", b[0].overBy, 13 * 60);
  eq("and the limit it breached", b[0].limitSeconds, 900);
}
eq("a compliant shift has no breaches", A.breaches(A.intervals(SHIFT, AFTER)), []);
{
  // Three breaks against a maximum of two.
  const many = [
    ev("LOGIN", 0),
    ev("AUX", hrs(1), "Break"), ev("AUX", hrs(1) + mins(10), "Available"),
    ev("AUX", hrs(2), "Break"), ev("AUX", hrs(2) + mins(10), "Available"),
    ev("AUX", hrs(3), "Break"), ev("AUX", hrs(3) + mins(10), "Available"),
    ev("LOGOUT", hrs(8)),
  ];
  const b = A.breaches(A.intervals(many, AFTER));
  eq("too many breaks is reported", b.filter((x) => x.kind === "too_many").length, 1);
  eq("with the count", b.find((x) => x.kind === "too_many").count, 3);
  eq("and no false over-limit breaches", b.filter((x) => x.kind === "over_limit").length, 0);
}
{
  // A break currently running over is a breach now, not once they return.
  const running = [ev("LOGIN", 0), ev("AUX", hrs(1), "Break")];
  const b = A.breaches(A.intervals(running, T0 + hrs(1) + mins(25)));
  eq("an open over-limit break is already a breach", b.length, 1);
  eq("and is flagged as still running", b[0].open, true);
}

console.log("\n── Adherence ──");
{
  const shift = { start: T0, end: T0 + hrs(8) };
  const a = A.adherence(A.intervals(SHIFT, AFTER), shift);
  eq("scheduled seconds", a.scheduledSeconds, 8 * 3600);
  // Presence is paid time, so the unpaid lunch does not count toward adherence.
  eq("in-window presence excludes unpaid time", a.inWindowSeconds, 8 * 3600 - 1800);
  eq("on time", a.lateBySeconds, 0);
  eq("not flagged late", A.isLate(a), false);
}
{
  // Logged in 20 minutes late.
  const late = [ev("LOGIN", mins(20)), ev("LOGOUT", hrs(8))];
  const a = A.adherence(A.intervals(late, AFTER), { start: T0, end: T0 + hrs(8) });
  eq("lateness measured from the schedule", a.lateBySeconds, 1200);
  eq("beyond grace, flagged late", A.isLate(a), true);
}
eq("inside grace, not late",
  A.isLate(A.adherence(A.intervals([ev("LOGIN", mins(3)), ev("LOGOUT", hrs(8))], AFTER), { start: T0, end: T0 + hrs(8) })),
  false);
{
  // Working outside the window is reported, never credited — crediting it
  // rewards an agent for working the wrong hours.
  const early = [ev("LOGIN", -hrs(2)), ev("LOGOUT", hrs(8))];
  const a = A.adherence(A.intervals(early, AFTER), { start: T0, end: T0 + hrs(8) });
  eq("unscheduled time is separated out", a.outOfWindowSeconds, 2 * 3600);
  eq("and adherence is still capped at 100", a.adherencePct <= 100, true);
}
eq("no schedule yields null rather than a made-up number",
  A.adherence(A.intervals(SHIFT, AFTER), null).adherencePct, null);
eq("a zero-length schedule is refused",
  A.adherence(A.intervals(SHIFT, AFTER), { start: T0, end: T0 }).adherencePct, null);

console.log("\n── Abandoned sessions ──");
{
  const open = [ev("LOGIN", 0)];
  eq("a normal session is not stale", A.staleSession(open, T0 + hrs(8)).stale, false);
  const s = A.staleSession(open, T0 + hrs(20));
  eq("beyond the maximum it is stale", s.stale, true);
  // Stamped at the deadline, not when the sweeper ran — otherwise a late cron
  // pays the agent for its own delay.
  eq("logout is stamped at the deadline", s.logoutAt, T0 + hrs(16));
  eq("logout time does not depend on when the sweeper runs",
    A.staleSession(open, T0 + hrs(40)).logoutAt, T0 + hrs(16));
}
eq("a closed session is never stale", A.staleSession(SHIFT, T0 + hrs(48)).stale, false);

console.log("\n── Local days, overnight shifts and DST ──");
// Cairo is UTC+2 in winter, UTC+3 in summer (DST returned in 2023).
eq("a winter instant maps to its Cairo day", A.localDay(Date.UTC(2026, 0, 15, 22, 0)), "2026-01-16");
eq("a summer instant maps to its Cairo day", A.localDay(Date.UTC(2026, 6, 15, 21, 30)), "2026-07-16");
eq("UTC date and Cairo date genuinely differ late in the day",
  A.localDay(Date.UTC(2026, 0, 15, 23, 0)) !== new Date(Date.UTC(2026, 0, 15, 23, 0)).toISOString().slice(0, 10),
  true);
eq("a malformed instant yields empty", A.localDay(NaN), "");
{
  // A night shift starting 21:00 Cairo and ending 05:00 must be ONE shift,
  // reported against the day it started — not split across midnight.
  const nightStart = Date.UTC(2026, 0, 15, 19, 0); // 21:00 Cairo
  const night = [
    { id: "n1", type: "LOGIN", at: nightStart },
    { id: "n2", type: "AUX", at: nightStart + hrs(4), aux: "Break" },   // 01:00, next day
    { id: "n3", type: "AUX", at: nightStart + hrs(4) + mins(15), aux: "Available" },
    { id: "n4", type: "LOGOUT", at: nightStart + hrs(8) },
  ];
  const byDay = A.shiftsByDay(A.intervals(night, nightStart + hrs(9)));
  eq("an overnight shift is one shift, not two", byDay.size, 1);
  eq("keyed on the day it started", [...byDay.keys()][0], "2026-01-15");
  eq("and the post-midnight break belongs to it",
    byDay.get("2026-01-15").some((i) => i.aux === "Break"), true);
}
{
  // Two separate shifts on different days stay separate.
  const two = [
    { id: "a1", type: "LOGIN", at: Date.UTC(2026, 0, 15, 7, 0) },
    { id: "a2", type: "LOGOUT", at: Date.UTC(2026, 0, 15, 15, 0) },
    { id: "b1", type: "LOGIN", at: Date.UTC(2026, 0, 16, 7, 0) },
    { id: "b2", type: "LOGOUT", at: Date.UTC(2026, 0, 16, 15, 0) },
  ];
  const byDay = A.shiftsByDay(A.intervals(two, Date.UTC(2026, 0, 16, 16, 0)));
  eq("two days, two shifts", byDay.size, 2);
  eq("in order", [...byDay.keys()].sort(), ["2026-01-15", "2026-01-16"]);
}
{
  // A shift crossing the DST change: Egypt springs forward on the last Friday
  // of April. Elapsed time comes from instants, so it needs no special case,
  // and the local day must still be right on both sides.
  const dstNight = Date.UTC(2026, 3, 23, 20, 0); // 22:00 Cairo, before the change
  const across = [
    { id: "d1", type: "LOGIN", at: dstNight },
    { id: "d2", type: "LOGOUT", at: dstNight + hrs(8) },
  ];
  const list = A.intervals(across, dstNight + hrs(9));
  eq("elapsed time is unaffected by the clock change", list[0].seconds, 8 * 3600);
  eq("and it is still a single shift", A.shiftsByDay(list).size, 1);
}

console.log("\n── AUX code metadata ──");
eq("every code declares productive and paid",
  A.AUX_LIST.every((k) => typeof A.AUX_CODES[k].productive === "boolean" && typeof A.AUX_CODES[k].paid === "boolean"),
  true);
/* The unpaid states are the two the agent chose to step away for. Break and
   prayer are paid; lunch and personal time are not. Getting this list wrong
   overstates the paybill, which is why it is pinned rather than described. */
eq("the unpaid states", A.AUX_LIST.filter((k) => !A.AUX_CODES[k].paid), ["Lunch", "Personal"]);
eq("productive codes", A.AUX_LIST.filter((k) => A.AUX_CODES[k].productive),
  ["Available", "InCall", "AfterCallWork", "BackOffice", "Outbound"]);
/* Adherence measures whether the agent was where they were scheduled to be. An
   agent sitting through a system outage was exactly there, so these states are
   excluded rather than counted against them. */
eq("states the agent did not cause are excused from adherence",
  A.AUX_LIST.filter((k) => A.AUX_CODES[k].countsToAdherence === false),
  ["Technical", "SystemOutage", "NoWorkAvailable"]);
eq("prayer time is a first-class state, not borrowed from break",
  A.isAux("Prayer") && A.AUX_CODES.Prayer.paid, true);
eq("isAux rejects nonsense", A.isAux("Nap"), false);
eq("the default state exists", A.isAux(A.DEFAULT_AUX), true);
eq("a system logout is distinguishable from an agent one",
  A.LOGOUT_SOURCES.includes("system") && A.LOGOUT_SOURCES.includes("agent"), true);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

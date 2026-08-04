/* My schedule.

   The assertions that matter are the ones about not lying to a shift worker:
   a day nobody has rostered must not read as a day off, a night shift must say
   where it ends, and "no more shifts published" has to be a visible answer
   rather than an empty list that looks like a quiet week. */

const S = await import("../src/lib/myschedule.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

/* 2026-08-04 is a Tuesday. */
const TODAY = "2026-08-04";
const row = (date, startTime, durationMinutes, activity = "Shift") => ({ date, startTime, durationMinutes, activity });

console.log("\n── Where a week starts ──");
eq("Tuesday's week starts on the Saturday before", S.weekStart("2026-08-04"), "2026-08-01");
eq("a Saturday is its own week start", S.weekStart("2026-08-01"), "2026-08-01");
eq("and a Friday closes that week", S.weekStart("2026-08-07"), "2026-08-01");
eq("a bad date is null rather than a guess", S.weekStart("nonsense"), null);

console.log("\n── A shift is a span, not a start time ──");
eq("an evening shift ends the same day", S.endTime("14:00", 480), "22:00");
eq("a night shift wraps past midnight", S.endTime("22:00", 480), "06:00");
ok("and says that it does", S.crossesMidnight("22:00", 480));
ok("a day shift does not", S.crossesMidnight("09:00", 480) === false);
eq("a shift with no duration has no span rather than a fake one",
  S.describeShift({ activity: "Leave", startTime: "", durationMinutes: 0 }).span, "");
{
  const d = S.describeShift(row(TODAY, "22:00", 480));
  eq("the span reads the way a person would say it", d.span, "22:00 → 06:00");
  eq("and the hours are the hours", d.hours, 8);
}
eq("an unknown activity still renders as itself rather than blank",
  S.describeShift({ activity: "Rehearsal" }).label, "Rehearsal");

console.log("\n── An unrostered day is not a day off ──");
{
  /* `Off` is a row on purpose. Collapsing "nobody scheduled them" into a blank
     square tells somebody they are free on a day the roster is simply missing,
     and they find out otherwise when the phone rings. */
  const weeks = S.buildWeeks(
    [row("2026-08-02", "09:00", 480), row("2026-08-03", "", 0, "Off")],
    { from: TODAY, weeks: 1, today: TODAY },
  );
  const byDate = Object.fromEntries(weeks[0].days.map((d) => [d.date, d.state]));
  eq("a rostered day is working", byDate["2026-08-02"], "working");
  eq("an explicit Off row is off", byDate["2026-08-03"], "off");
  eq("and a day with nothing on it is unscheduled, not off", byDate["2026-08-04"], "unscheduled");
  eq("every day of the week is present", weeks[0].days.length, 7);
  eq("the week is labelled by its ends", [weeks[0].start, weeks[0].end], ["2026-08-01", "2026-08-07"]);
}

console.log("\n── Hours ──");
{
  const weeks = S.buildWeeks(
    [
      row("2026-08-02", "09:00", 480),
      row("2026-08-03", "09:00", 480, "Training"),
      row("2026-08-04", "", 0, "Off"),
      row("2026-08-05", "09:00", 240),
    ],
    { from: TODAY, weeks: 1, today: TODAY },
  );
  /* Training is paid, so a training week still reads as a worked week. A day
     off is not, so it does not inflate the total. */
  eq("paid activities count toward the week", weeks[0].hours, 20);
  eq("and only the covering ones count as working days", weeks[0].working, 3);
  ok("days off are not counted as working", weeks[0].days.find((d) => d.date === "2026-08-04").state === "off");
}

console.log("\n── When do I work next ──");
{
  const rows = [
    row("2026-08-04", "22:00", 480),
    row("2026-08-06", "09:00", 480),
    row("2026-08-05", "09:00", 480, "Meeting"),
  ];
  const noon = Date.parse("2026-08-04T12:00:00Z");
  const n = S.nextShift(rows, { now: noon, today: TODAY });
  eq("tonight's shift is next", n.date, "2026-08-04");
  eq("and it is described as today", n.when, "today");
  ok("with the time until it", S.untilText(n.inMinutes) === "in 10 hours", S.untilText(n.inMinutes));

  /* A meeting is on the roster and is not the answer to "when do I work next". */
  const afterStart = Date.parse("2026-08-04T23:00:00Z");
  const n2 = S.nextShift(rows, { now: afterStart, today: TODAY });
  eq("once tonight's shift has started, the next one is the answer", n2.date, "2026-08-06");
  eq("skipping the meeting in between", n2.activity, "Shift");
  eq("and a shift two days out says so", n2.when, "2026-08-06");

  const tomorrow = S.nextShift([row("2026-08-05", "09:00", 480)], { now: noon, today: TODAY });
  eq("tomorrow is called tomorrow", tomorrow.when, "tomorrow");

  eq("no upcoming shift is null, not an empty object", S.nextShift([], { now: noon, today: TODAY }), null);
  eq("and a roster that only has the past is null too",
    S.nextShift([row("2026-08-01", "09:00", 480)], { now: noon, today: TODAY }), null);
}

console.log("\n── Saying it in words ──");
eq("under an hour", S.untilText(35), "in 35 min");
eq("never 'in 0 min'", S.untilText(0), "in 1 min");
eq("hours", S.untilText(180), "in 3 hours");
eq("one hour is singular", S.untilText(60), "in 1 hour");
eq("days", S.untilText(60 * 24 * 3), "in 3 days");
eq("one day is singular", S.untilText(60 * 24), "in 1 day");

console.log("\n── How far the roster reaches ──");
{
  /* A roster published to the end of this week is a real problem for anyone
     arranging childcare, and it is invisible unless something says so. */
  const short = S.horizon([row("2026-08-06", "09:00", 480)], { today: TODAY });
  eq("a roster two days out is short", short.days, 2);
  ok("and says so with the date", short.short && /2026-08-06/.test(short.message));

  const fine = S.horizon([row("2026-09-04", "09:00", 480)], { today: TODAY });
  ok("a month out is not flagged", fine.short === false && fine.message === null);

  const none = S.horizon([], { today: TODAY });
  ok("nothing published at all says who publishes it", /lead publishes/.test(none.message));
  ok("and is treated as short", none.short);

  eq("past shifts do not count toward the horizon",
    S.horizon([row("2026-07-01", "09:00", 480)], { today: TODAY }).last, null);
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

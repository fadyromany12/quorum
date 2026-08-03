/* Attendance exceptions.

   Every exception this module emits can become a disciplinary case against a
   real person. So the assertions that matter most here are the negative ones:
   the days it must stay quiet about. An engine that finds every genuine no-show
   and also accuses four people on approved leave is worse than no engine, because
   the four will be believed the first time and nothing will be believed after.

   The positive cases are easy and are tested too. The false-positive cases are
   the reason the file exists. */

const E = await import("../src/lib/exceptions.js");
const { DEFAULT_DCM } = await import("../src/lib/dcm.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

const DAY = "2026-03-10";
const H = (h, m = 0) => Date.UTC(2026, 2, 10, h, m) ;
/* A shift 09:00–17:00, and paid presence built from it. `Available` is a paid
   AUX in the taxonomy; the intervals mirror what attendance.js produces. */
const shift = { start: H(9), end: H(17) };
const present = (fromH, toH, aux = "Available") => ({
  aux, from: H(fromH), to: H(toH), seconds: Math.floor((H(toH) - H(fromH)) / 1000), open: false,
});
const onFloor = { activity: "Shift", startTime: "09:00", durationMinutes: 480 };
const kinds = (r) => r.exceptions.map((e) => e.kind);

console.log("\n── The days it must stay quiet about ──");

eq("approved leave is not a no-show",
  kinds(E.exceptionsFor({
    date: DAY, scheduled: onFloor, shift, intervals: [],
    approvedLeave: [{ from: "2026-03-09", to: "2026-03-11" }], nowMs: H(23),
  })), []);

eq("leave ending on the day still covers it — inclusive at both ends",
  kinds(E.exceptionsFor({
    date: DAY, scheduled: onFloor, shift, intervals: [],
    approvedLeave: [{ from: "2026-03-05", to: DAY }], nowMs: H(23),
  })), []);

eq("a shift that has not started is not a no-show",
  kinds(E.exceptionsFor({
    date: DAY, scheduled: onFloor, shift, intervals: [], approvedLeave: [], nowMs: H(6),
  })), []);

eq("someone mid-shift has not left early",
  kinds(E.exceptionsFor({
    date: DAY, scheduled: onFloor, shift, intervals: [present(9, 13)], approvedLeave: [], nowMs: H(13),
  })), []);

eq("a day with no roster row and no login is not an absence",
  kinds(E.exceptionsFor({ date: DAY, scheduled: null, shift: null, intervals: [], approvedLeave: [], nowMs: H(23) })), []);

eq("a rostered day off, not worked, is nothing at all",
  kinds(E.exceptionsFor({
    date: DAY, scheduled: { activity: "Off" }, shift: null, intervals: [], approvedLeave: [], nowMs: H(23),
  })), []);

eq("arriving inside the grace period is not late",
  kinds(E.exceptionsFor({
    date: DAY, scheduled: onFloor, shift, intervals: [present(9, 17)], approvedLeave: [], nowMs: H(23),
  })), []);

eq("leaving inside the grace period is not early",
  /* 16:56 against a 17:00 end — four minutes, inside the five-minute grace. */
  kinds(E.exceptionsFor({
    date: DAY, scheduled: onFloor, shift,
    intervals: [{ aux: "Available", from: H(9), to: H(16, 56), seconds: 28560, open: false }],
    approvedLeave: [], nowMs: H(23),
  })), []);

console.log("\n── Absence cannot be judged without knowing what was approved ──");
{
  const r = E.exceptionsFor({ date: DAY, scheduled: onFloor, shift, intervals: [], nowMs: H(23) });
  eq("omitting approved leave produces no exceptions", r.exceptions, []);
  ok("and says why rather than failing silently", r.undetermined.some((u) => /approved leave/i.test(u)));
}

console.log("\n── The days it must speak up about ──");
eq("scheduled, no login, no leave, shift over — a no show",
  kinds(E.exceptionsFor({
    date: DAY, scheduled: onFloor, shift, intervals: [], approvedLeave: [], nowMs: H(23),
  })), ["noShow"]);

eq("arriving well after the grace is late",
  kinds(E.exceptionsFor({
    date: DAY, scheduled: onFloor, shift, intervals: [present(10, 17)], approvedLeave: [], nowMs: H(23),
  })), ["late"]);

eq("leaving an hour early, once the shift is over",
  kinds(E.exceptionsFor({
    date: DAY, scheduled: onFloor, shift, intervals: [present(9, 16)], approvedLeave: [], nowMs: H(23),
  })), ["leftEarly"]);

eq("working with nothing on the roster",
  kinds(E.exceptionsFor({
    date: DAY, scheduled: null, shift: null, intervals: [present(9, 13)], approvedLeave: [], nowMs: H(23),
  })), ["unscheduled"]);

{
  const r = E.exceptionsFor({
    date: DAY, scheduled: onFloor, shift, intervals: [present(10, 16)], approvedLeave: [], nowMs: H(23),
  });
  eq("late and early are both reported, not collapsed", kinds(r), ["late", "leftEarly"]);
  ok("late carries how late, in seconds", r.exceptions[0].bySeconds === 3600);
}

console.log("\n── Every exception names a rule the matrix actually defines ──");
eq("nothing is mis-wired", E.checkExceptions(DEFAULT_DCM), []);
{
  const ids = new Set(DEFAULT_DCM.map((r) => r.id));
  for (const [kind, meta] of Object.entries(E.EXCEPTION_KINDS)) {
    ok(`${kind} → "${meta.violationId}" exists in the matrix`, ids.has(meta.violationId));
  }
}
ok("a renamed matrix rule is caught rather than silently unmatched",
  E.checkExceptions([{ id: "late" }]).some((p) => /does not define/.test(p)));

console.log("\n── Resolving a shift to instants ──");
/* This got it wrong, live, and the screen said "the shift has not started yet"
   at three in the afternoon. The predicate is the trap: "this instant falls on
   that local day" is true for the whole twenty-four hours, so searching for the
   first match returns whatever the search happened to start from, not midnight.
   Midnight is the instant that is on the day when the minute before it is not. */
{
  const TZ = "Africa/Cairo";
  const mid = E.localMidnight("2026-08-03", TZ);
  const iso = new Date(mid).toISOString();
  ok(`local midnight is the start of the day, not some hour inside it (${iso})`,
    iso === "2026-08-02T21:00:00.000Z" || iso === "2026-08-02T22:00:00.000Z",
    `got ${iso} — Cairo is UTC+2 or +3, so midnight local is 21:00 or 22:00 the day before`);

  const w = E.shiftWindow("2026-08-03", "09:00", 480, TZ);
  const startHour = new Date(w.start).getUTCHours();
  ok(`a 09:00 shift starts in the morning UTC, not the evening (${startHour}:00Z)`,
    startHour >= 5 && startHour <= 8, `got ${new Date(w.start).toISOString()}`);
  eq("and runs for its duration", (w.end - w.start) / 60000, 480);

  eq("an unparseable date resolves to nothing rather than to NaN", E.shiftWindow("not-a-date", "09:00", 480, TZ), null);
  eq("a roster row with no start time has no window", E.shiftWindow("2026-08-03", "", 480, TZ), null);
  eq("nor does one with no duration", E.shiftWindow("2026-08-03", "09:00", 0, TZ), null);

  /* The consequence the bug actually had: a shift resolved to the wrong instant
     makes a finished shift look like one that has not begun, and a real no-show
     is reported as "cannot tell". */
  const r = E.exceptionsFor({
    date: "2026-08-03", scheduled: { activity: "Shift", startTime: "09:00", durationMinutes: 480 },
    shift: E.shiftWindow("2026-08-03", "09:00", 480, TZ), intervals: [], approvedLeave: [],
    nowMs: Date.parse("2026-08-03T15:00:00Z"),
  });
  eq("a shift that ran this morning and nobody attended is a no show", kinds(r), ["noShow"]);
}

console.log("\n── An unresolvable window says so, rather than blaming the clock ──");
{
  const r = E.exceptionsFor({
    date: DAY, scheduled: onFloor, shift: null, intervals: [], approvedLeave: [], nowMs: H(23),
  });
  eq("no exception is raised", kinds(r), []);
  ok("and the reason points at the roster, not at the time of day",
    r.undetermined.some((u) => /could not be resolved/i.test(u)),
    r.undetermined.join(" | "));
}

console.log("\n── Ranking puts the morning's problem first ──");
{
  const rows = [
    { kind: "overBreak", employeeName: "Zed" },
    { kind: "noShow", employeeName: "Amr" },
    { kind: "late", employeeName: "Nour" },
  ];
  eq("worst first", E.rankExceptions(rows).map((r) => r.kind), ["noShow", "late", "overBreak"]);
  ok("and the input is not mutated", rows[0].kind === "overBreak");
}

console.log("\n── The summary counts people, not incidents ──");
{
  const s = E.summariseDay([
    { kind: "overBreak", employeeId: "a" },
    { kind: "overBreak", employeeId: "a" },
    { kind: "late", employeeId: "b" },
  ]);
  eq("three exceptions", s.total, 3);
  eq("across two people — one agent over-running twice is one conversation", s.people, 2);
  eq("broken down by kind", s.byKind, { overBreak: 2, late: 1 });
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

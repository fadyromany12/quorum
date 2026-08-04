/* The staffing mathematics.

   The important test here is the cross-check: the recurrence form of Erlang B
   is fast and cannot overflow, but it is also easy to get subtly wrong in a way
   that still returns a plausible number between 0 and 1. So the textbook
   factorial form is implemented independently below and the two are required to
   agree to ten decimal places for every small case. The recurrence then carries
   the large cases the factorial form cannot reach at all.

   Everything else is properties rather than remembered constants: service level
   rises with agents, the requirement meets the target and one fewer agent does
   not, shrinkage divides rather than multiplies, and coverage never nets a
   morning shortfall off against an afternoon surplus. */

const W = await import("../src/lib/wfm.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const near = (label, got, want, tol = 1e-10) =>
  ok(label, Math.abs(got - want) <= tol, `got ${got}, want ${want} (±${tol})`);
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

/* The textbook form, for cross-checking only. Written in its kinder
   incremental shape — computing a^k/k! term by term rather than dividing one
   overflowed factorial by another — which survives far longer than the literal
   formula but still gives up around a thousand erlangs. */
function textbookErlangC(n, a) {
  let sum = 0;
  for (let k = 0; k < n; k++) {
    let term = 1;
    for (let i = 1; i <= k; i++) term *= a / i;
    sum += term;
  }
  let top = 1;
  for (let i = 1; i <= n; i++) top *= a / i;
  top *= n / (n - a);
  return top / (sum + top);
}

console.log("\n── Erlang B, against its own definition ──");
near("no servers blocks everything", W.erlangB(0, 5), 1);
near("one server is a/(1+a)", W.erlangB(1, 4), 4 / 5);
near("two servers follow the recurrence", W.erlangB(2, 4), (4 * (4 / 5)) / (2 + 4 * (4 / 5)));
ok("blocking always sits in (0,1]", [0.1, 1, 7, 50, 400].every((a) => {
  const b = W.erlangB(30, a);
  return b > 0 && b <= 1;
}));
ok("more servers never block more", (() => {
  let prev = 2;
  for (let n = 0; n <= 60; n++) {
    const b = W.erlangB(n, 20);
    if (b > prev + 1e-15) return false;
    prev = b;
  }
  return true;
})());

console.log("\n── Erlang C matches the textbook form it replaces ──");
let agree = true, worst = 0;
for (const a of [0.5, 2, 5, 10, 17.3, 40]) {
  for (let n = Math.ceil(a) + 1; n <= Math.ceil(a) + 20; n++) {
    const d = Math.abs(W.erlangC(n, a).probabilityOfWait - textbookErlangC(n, a));
    worst = Math.max(worst, d);
    if (d > 1e-10) agree = false;
  }
}
ok("across 120 agent/load pairs", agree, `worst disagreement ${worst}`);

console.log("\n── Where Erlang C stops being valid, it says so ──");
eq("load equal to the agents is unstable",
  (({ probabilityOfWait, stable }) => ({ probabilityOfWait, stable }))(W.erlangC(10, 10)),
  { probabilityOfWait: 1, stable: false });
eq("load above the agents is unstable",
  (({ probabilityOfWait, stable }) => ({ probabilityOfWait, stable }))(W.erlangC(10, 14)),
  { probabilityOfWait: 1, stable: false });
ok("an unstable queue reports no service level", W.serviceLevel(10, 12, 300, 20) === 0);
ok("and no average speed of answer, rather than a fictional one", W.averageSpeedOfAnswer(10, 12, 300) === null);
ok("an idle queue is fully served", W.serviceLevel(5, 0, 300, 20) === 1);

console.log("\n── Large intervals, where the closed forms cannot go ──");
const big = W.erlangC(520, 500);
ok("500 erlangs on 520 agents stays finite", Number.isFinite(big.probabilityOfWait) && big.probabilityOfWait > 0 && big.probabilityOfWait < 1);
ok("and its service level is a real number", (() => {
  const sl = W.serviceLevel(520, 500, 300, 20);
  return Number.isFinite(sl) && sl >= 0 && sl <= 1;
})());
/* 1000 erlangs is where the incremental form gives up: a^k/k! peaks past
   1e308 and the ratio becomes Infinity/Infinity. The recurrence never leaves
   (0,1] and does not notice. */
ok("the textbook form has overflowed by a thousand erlangs", !Number.isFinite(textbookErlangC(1100, 1000)));
ok("the recurrence has not", (() => {
  const c = W.erlangC(1100, 1000);
  return Number.isFinite(c.probabilityOfWait) && c.probabilityOfWait > 0 && c.probabilityOfWait < 1;
})());
ok("nor at a scale no contact centre will reach", Number.isFinite(W.erlangC(5200, 5000).probabilityOfWait));

console.log("\n── Offered load: the units trap ──");
near("420 contacts at 260s over 30 minutes is 60.67 erlangs", W.offeredLoad(420, 260, 30), (420 * 260) / 1800, 1e-9);
near("the same volume in a 15-minute interval is twice the load", W.offeredLoad(420, 260, 15), (420 * 260) / 900, 1e-9);
near("and an hour is half of the half-hour figure", W.offeredLoad(420, 260, 60), (420 * 260) / 3600, 1e-9);
ok("no contacts is no load", W.offeredLoad(0, 300, 30) === 0);

console.log("\n── Service level rises with agents, never falls ──");
ok("monotonic across 60 staffing levels", (() => {
  let prev = -1;
  for (let n = 11; n <= 70; n++) {
    const sl = W.serviceLevel(n, 10, 240, 20);
    if (sl < prev - 1e-15) return false;
    prev = sl;
  }
  return true;
})());

console.log("\n── The requirement is the smallest number that works ──");
for (const [contacts, aht] of [[100, 180], [420, 260], [37, 600], [1500, 210]]) {
  const r = W.requiredAgents({ contacts, ahtSeconds: aht, intervalMinutes: 30, targetSeconds: 20, targetServiceLevel: 0.8, maxOccupancy: 1 });
  ok(`${contacts}@${aht}s meets the 80/20 target`, r.serviceLevel >= 0.8);
  ok(`${contacts}@${aht}s — one fewer agent misses it`,
    W.serviceLevel(r.agents - 1, r.load, aht, 20) < 0.8,
    `at ${r.agents - 1}: ${W.serviceLevel(r.agents - 1, r.load, aht, 20)}`);
}
ok("no contacts needs nobody", W.requiredAgents({ contacts: 0, ahtSeconds: 300 }).agents === 0);
ok("a harder target never needs fewer people", (() => {
  const a = W.requiredAgents({ contacts: 420, ahtSeconds: 260, targetServiceLevel: 0.8, maxOccupancy: 1 }).agents;
  const b = W.requiredAgents({ contacts: 420, ahtSeconds: 260, targetServiceLevel: 0.95, maxOccupancy: 1 }).agents;
  return b >= a;
})());
ok("a tighter answer threshold never needs fewer people", (() => {
  const a = W.requiredAgents({ contacts: 420, ahtSeconds: 260, targetSeconds: 20, maxOccupancy: 1 }).agents;
  const b = W.requiredAgents({ contacts: 420, ahtSeconds: 260, targetSeconds: 5, maxOccupancy: 1 }).agents;
  return b >= a;
})());

console.log("\n── The occupancy cap, which is the point of the whole thing ──");
const uncapped = W.requiredAgents({ contacts: 900, ahtSeconds: 240, maxOccupancy: 1 });
const capped = W.requiredAgents({ contacts: 900, ahtSeconds: 240, maxOccupancy: 0.85 });
ok("a high-volume interval would run hot without it", uncapped.occupancy > 0.85);
ok("the cap adds people rather than accepting it", capped.agents > uncapped.agents);
ok("and brings occupancy under the ceiling", capped.occupancy <= 0.85 + 1e-9, `got ${capped.occupancy}`);
ok("the cap says when it was the binding constraint", capped.cappedByOccupancy === true && uncapped.cappedByOccupancy === false);
ok("a small interval is unaffected by it", W.requiredAgents({ contacts: 20, ahtSeconds: 180 }).cappedByOccupancy === false);

console.log("\n── Shrinkage divides. It does not multiply. ──");
ok("100 on the phone at 30% shrinkage needs 143 rostered, not 130", W.rosteredFor(100, 0.3) === 143);
ok("no shrinkage changes nothing", W.rosteredFor(40, 0) === 40);
ok("an impossible shrinkage is clamped rather than dividing by zero",
  Number.isFinite(W.rosteredFor(10, 1)) && Number.isFinite(W.rosteredFor(10, 4)));
ok("a negative shrinkage cannot shrink the roster", W.rosteredFor(40, -0.5) === 40);

const sh = W.shrinkageFrom({ paidHours: 1000, breakHours: 100, trainingHours: 120, leaveHours: 80, absenceHours: 20 });
near("measured shrinkage is lost over paid", sh.shrinkage, 0.32, 1e-12);
ok("and comes with its breakdown", sh.parts.length === 4 && sh.parts.every((p) => p.hours > 0));
ok("training is nameable as its own share", (() => {
  const t = sh.parts.find((p) => p.name === "Training");
  return t && Math.abs(t.share - 0.12) < 1e-12;
})());
ok("zero paid hours does not divide by zero", W.shrinkageFrom({ paidHours: 0, breakHours: 5 }).shrinkage === 0);
ok("shrinkage is capped below 1 so the roster stays computable", W.shrinkageFrom({ paidHours: 10, breakHours: 40 }).shrinkage < 1);

console.log("\n── Coverage never nets a shortfall off against a surplus ──");
const plan = [
  { interval: "09:00", rostered: 10 },
  { interval: "09:30", rostered: 12 },
  { interval: "10:00", rostered: 14 },
  { interval: "16:00", rostered: 8 },
];
const cov = W.coverage(plan, { "09:00": 10, "09:30": 6, "10:00": 12, "16:00": 14 });
eq("each interval is judged on its own", cov.rows.map((r) => r.state), ["met", "under", "under", "over"]);
ok("short and spare are counted separately", cov.agentHoursShort === 8 && cov.agentHoursSpare === 6);
ok("a day with any shortfall is not covered", cov.covered === false);
eq("the worst interval is named", cov.worstUnder.interval, "09:30");
ok("a fully covered day says so", W.coverage(plan, { "09:00": 10, "09:30": 12, "10:00": 14, "16:00": 8 }).covered === true);
ok("an unscheduled interval counts as zero, not as covered",
  W.coverage([{ interval: "09:00", rostered: 5 }], {}).understaffedIntervals === 1);

console.log("\n── Whether one more absence is affordable ──");
const afford = W.canAfford(cov, ["09:00", "16:00"]);
ok("the tightest interval decides, not the average", afford.tightest.interval === "09:00");
ok("and a met interval has no room for one more", afford.affordable === false);
ok("the reason is a sentence, not a code", /09:00/.test(afford.reason));
const spare = W.canAfford(cov, ["16:00"]);
ok("an over-covered interval can spare someone", spare.affordable === true && spare.headroom === 6);
ok("six can be spared but seven cannot", W.canAfford(cov, ["16:00"], 7).affordable === false);
ok("an absence touching no planned interval is affordable", W.canAfford(cov, ["03:00"]).affordable === true);

console.log("\n── Intervals ──");
ok("a 30-minute day has 48 intervals", W.intervalsPerDay(30) === 48);
ok("a 15-minute day has 96", W.intervalsPerDay(15) === 96);
ok("09:30 is the twentieth half-hour", W.intervalOf("09:30", 30) === 19);
eq("and indexes back to its label", W.intervalLabel(19, 30), "09:30");
eq("the first interval is midnight", W.intervalLabel(0, 30), "00:00");
eq("quarter-hours round-trip too", W.intervalLabel(W.intervalOf("14:45", 15), 15), "14:45");

console.log("\n── The plan, and its explanation ──");
const day = W.planDay(
  [{ interval: "09:00", contacts: 420 }, { interval: "09:30", contacts: 200 }],
  { ahtSeconds: 260, shrinkage: 0.3, intervalMinutes: 30 }
);
ok("every interval gets a rostered figure above its on-phone one", day.every((d) => d.rostered >= d.onPhone));
ok("a busier interval never needs fewer people", day[0].onPhone >= day[1].onPhone);
const ex = W.explain({ interval: "09:00", contacts: 420 }, { ahtSeconds: 260, shrinkage: 0.3 });
ok("the explanation states the load it derived", ex.lines.some((l) => /erlangs of load/.test(l)));
ok("it names the target it was measured against", ex.lines.some((l) => /against a 80% target/.test(l)));
ok("and it says shrinkage was applied", ex.lines.some((l) => /30% shrinkage/.test(l)));
ok("with no shrinkage it does not mention it",
  !W.explain({ interval: "09:00", contacts: 420 }, { ahtSeconds: 260 }).lines.some((l) => /shrinkage/.test(l)));

console.log("\n── A forecast is checked before it is trusted ──");
eq("a good forecast has no problems",
  W.checkForecast([{ interval: "09:00", contacts: 420, ahtSeconds: 260 }]), []);
ok("an empty forecast is refused", W.checkForecast([]).length === 1);
ok("a duplicated interval is caught",
  W.checkForecast([{ interval: "09:00", contacts: 1, ahtSeconds: 200 }, { interval: "09:00", contacts: 2, ahtSeconds: 200 }])
    .some((p) => /more than once/.test(p)));
ok("a missing handling time is caught",
  W.checkForecast([{ interval: "09:00", contacts: 420 }]).some((p) => /no handling time/.test(p)));
ok("handling time pasted in minutes is caught as a unit error",
  W.checkForecast([{ interval: "09:00", contacts: 420, ahtSeconds: 4200 }]).some((p) => /units are seconds/.test(p)));
ok("a negative volume is caught",
  W.checkForecast([{ interval: "09:00", contacts: -3, ahtSeconds: 200 }]).some((p) => /contact volume/.test(p)));
ok("an impossible target is caught",
  W.checkForecast([{ interval: "09:00", contacts: 1, ahtSeconds: 200 }], { targetServiceLevel: 1 }).some((p) => /between 0 and 1/.test(p)));


console.log("\n── Intraday: required, rostered and actually here ──");
{
  /* The real shape planDay() emits — `rostered` is the requirement. Written
     from the producer, because the first version of this fixture invented
     `{ agents }`, which planDay has never produced: the test passed and every
     real requirement came through as zero. */
  const plan = [
    { interval: "09:00", onPhone: 9, rostered: 10 },
    { interval: "09:30", onPhone: 11, rostered: 12 },
    { interval: "10:00", onPhone: 11, rostered: 12 },
  ];
  const scheduled = { "09:00": 10, "09:30": 11, "10:00": 12 };
  const actual = { "09:00": 10, "09:30": 8 };

  const rows = W.intraday({ plan, scheduled, actual, nowInterval: "09:30" });

  /* The rule the whole thing is built around. A future interval has no actual,
     and showing it as zero would paint every afternoon red every morning —
     unknown is a third state, not a small number. */
  eq("a future interval reports no actual rather than zero", rows[2].actual, null);
  eq("and is not judged", rows[2].state, "unknown");
  eq("the interval in progress counts as known — real people are in it", rows[1].actual, 8);
  eq("as does one already past", rows[0].actual, 10);

  /* The gap this screen exists for: the roster looked one short and the floor
     is four short, because three people are not where the roster says. */
  eq("the roster gap and the live gap are different numbers", [rows[1].rosterGap, rows[1].liveGap], [-1, -4]);
  eq("and the state follows the live number, not the roster", rows[1].state, "short");
  eq("a fully covered interval says so", rows[0].state, "covered");

  /* Before anything has started there is no live number, so the roster is the
     only thing that can be wrong — and it is judged on that instead. */
  const planned = W.intraday({ plan, scheduled, actual: null });
  eq("with no actual at all, every interval is judged on the roster",
    planned.map((r) => r.state), ["covered", "tight", "covered"]);
  eq("and none of them claim an actual", planned.every((r) => r.actual === null), true);

  /* The bug the first version had, and the reason it survived a passing test:
     it flipped a flag when it saw nowInterval in the plan. A plan only contains
     intervals that have forecast rows, so when the clock stands in one the plan
     does not contain — which is most of the time — the flag never fired and
     every future interval reported an actual of zero. Labels are zero-padded
     HH:MM, so comparing them is comparing times, sparse plan or not. */
  const sparse = W.intraday({
    plan: [{ interval: "09:00", rostered: 10 }, { interval: "22:00", rostered: 4 }],
    scheduled: { "09:00": 2 },
    actual: {},
    nowInterval: "04:30", // not in the plan
  });
  eq("a clock standing outside the plan still marks later intervals unknown",
    sparse.map((r) => r.state), ["unknown", "unknown"]);
  eq("and none of them invent a zero", sparse.map((r) => r.actual), [null, null]);

  const midday = W.intraday({
    plan: [{ interval: "09:00", rostered: 10 }, { interval: "22:00", rostered: 4 }],
    scheduled: { "09:00": 10 },
    actual: { "09:00": 10 },
    nowInterval: "12:15", // also not in the plan, but after the first interval
  });
  eq("an interval already past is judged even when the clock is between rows",
    [midday[0].state, midday[1].state], ["covered", "unknown"]);

  const s = W.intradaySummary(rows);
  eq("the summary counts only what could be judged", [s.intervals, s.judged], [3, 2]);
  eq("one interval is short", s.short, 1);
  /* Named rather than averaged: an average day with one interval four short is
     not an average problem, it is that interval. */
  eq("and the worst one is named", s.worst.interval, "09:30");
  eq("a day with nothing short names no worst interval",
    W.intradaySummary(W.intraday({ plan, scheduled: { "09:00": 20, "09:30": 20, "10:00": 20 }, actual: null })).worst, null);
}

console.log("\n── Presence is counted by overlap, not by where the interval began ──");
{
  const onQueue = (aux) => aux === "Available";
  const day = Date.UTC(2026, 2, 10, 0, 0);
  const at = (h, m) => day + (h * 60 + m) * 60000;
  /* The boundary is half the slot — 15 minutes of a 30-minute interval.
     One agent is there 09:00–09:10 (ten minutes, under it), another
     09:05–09:30 (twenty-five, over it). Only the second was really there. */
  const list = [
    { aux: "Available", from: at(9, 0), to: at(9, 10) },
    { aux: "Available", from: at(9, 5), to: at(9, 30) },
    { aux: "Break", from: at(9, 0), to: at(9, 30) },
  ];
  const p = W.presenceByInterval(list, onQueue, day, 30);
  eq("someone there for most of the interval counts, someone barely there does not", p["09:00"], 1);
  eq("a break is not queue-facing, however long it is", p["09:30"] ?? 0, 0);
  /* Exactly half counts — the boundary has to fall somewhere and an agent
     present for half the interval was present. */
  eq("exactly half the interval counts",
    W.presenceByInterval([{ aux: "Available", from: at(9, 0), to: at(9, 15) }], onQueue, day, 30)["09:00"], 1);
  eq("a minute under does not",
    W.presenceByInterval([{ aux: "Available", from: at(9, 0), to: at(9, 14) }], onQueue, day, 30)["09:00"], 0);
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

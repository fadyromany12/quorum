/* Workforce management — the staffing mathematics, pure and no I/O.

   "Reliable" was the requirement, and in WFM that means one specific thing:
   the numbers have to be re-derivable. A planner who cannot explain why the
   tool asked for 34 agents at 11:00 will override it, and once they override it
   once they stop reading it. So every function here is pure, every input is
   named, and `explain()` returns the working rather than just the answer.

   ── Why Erlang C, and where it lies ────────────────────────────────────────
   Erlang C is the standard model for an inbound queue: Poisson arrivals,
   exponential handling times, infinite queue, no abandonment, homogeneous
   agents. Three of those are false in a real contact centre. It is used anyway
   because it is conservative in the direction that matters — ignoring
   abandonment means it over-states the queue, so it over-staffs slightly rather
   than leaving a queue unmanned — and because everyone in the industry reads
   its outputs. What it must never be is silently wrong, so `erlangC()` returns
   the intermediate terms and the caller can see them.

   The classic formula is written with factorials and overflows past n = 170 in
   float64, because 171! is already Infinity. Rewriting it to build a^k/k!
   incrementally buys a lot of room but still collapses to Infinity/Infinity
   somewhere around a thousand erlangs. Neither ceiling is reachable by this
   account today; both are reachable by a shared services floor, and a staffing
   tool that returns NaN at scale is worse than one that is merely slow. So
   Erlang B is computed with the standard recurrence instead:

       B(0, a) = 1
       B(n, a) = a·B(n-1, a) / (n + a·B(n-1, a))

   which never leaves the range (0, 1] and is stable for any n a call centre
   will ever have. Erlang C is then derived from B rather than from factorials.

   ── Shrinkage is measured, not guessed ─────────────────────────────────────
   The usual practice is a single number someone typed in 2019 — "we use 30%".
   That number is the difference between a plan that works and one that quietly
   understaffs every afternoon. `shrinkageFrom()` derives it from the hours the
   system already records: leave taken, training booked, breaks, absence. A
   planner may still override it, but the override is visible and the derived
   figure sits next to it.

   ── Units ──────────────────────────────────────────────────────────────────
   Everything is seconds and whole contacts. Intervals are minutes. Rates are
   contacts per interval, never per hour, because "calls per hour in a 30-minute
   interval" is the single most common arithmetic error in this domain. */

/** Planning intervals, in minutes. 30 is the industry default; 15 is used for
    volatile queues where a 30-minute average hides a spike. */
export const INTERVAL_MINUTES = [15, 30, 60];
export const DEFAULT_INTERVAL = 30;

/** How many intervals of a given width fill a day. */
export const intervalsPerDay = (minutes = DEFAULT_INTERVAL) => Math.round(1440 / minutes);

/**
 * Interval index (0-based) for a HH:MM clock time.
 * @param {string} hhmm
 * @param {number} minutes interval width
 */
export function intervalOf(hhmm, minutes = DEFAULT_INTERVAL) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return Math.floor((h * 60 + m) / minutes);
}

/** The HH:MM label an interval index starts at. */
export function intervalLabel(index, minutes = DEFAULT_INTERVAL) {
  const total = index * minutes;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* ── Erlang ────────────────────────────────────────────────────────────────── */

/**
 * Offered load in erlangs — the number of agents that would be busy with no
 * queueing at all. This is the one number everything else is built on:
 * `contacts` arriving in an interval, each occupying an agent for `aht`
 * seconds, spread over the interval's length.
 *
 * @param {number} contacts contacts offered in the interval
 * @param {number} ahtSeconds average handling time (talk + after-call work)
 * @param {number} intervalMinutes
 * @returns {number} erlangs
 */
export function offeredLoad(contacts, ahtSeconds, intervalMinutes = DEFAULT_INTERVAL) {
  const c = Math.max(0, Number(contacts) || 0);
  const a = Math.max(0, Number(ahtSeconds) || 0);
  const secs = Math.max(1, intervalMinutes * 60);
  return (c * a) / secs;
}

/**
 * Erlang B — the blocking probability with `n` servers and load `a`, computed
 * by the recurrence rather than the factorial form so it cannot overflow.
 */
export function erlangB(n, a) {
  const agents = Math.max(0, Math.floor(n));
  const load = Math.max(0, a);
  let b = 1; // B(0) = 1: with no servers, everything blocks
  for (let i = 1; i <= agents; i++) b = (load * b) / (i + load * b);
  return b;
}

/**
 * Erlang C — the probability a contact has to wait at all.
 *
 * Returns the working as well as the answer. When the offered load meets or
 * exceeds the agent count the queue is unstable: waiting is certain and the
 * wait itself is unbounded, so `probabilityOfWait` is 1 and the derived service
 * level is 0 rather than some plausible-looking number from a formula that has
 * already stopped being valid.
 *
 * @param {number} agents
 * @param {number} load offered load in erlangs
 * @returns {{probabilityOfWait: number, utilisation: number, stable: boolean, erlangB: number}}
 */
export function erlangC(agents, load) {
  const n = Math.max(0, Math.floor(agents));
  const a = Math.max(0, load);
  if (n === 0) return { probabilityOfWait: a > 0 ? 1 : 0, utilisation: a > 0 ? 1 : 0, stable: false, erlangB: 1 };
  const rho = a / n;
  if (rho >= 1) return { probabilityOfWait: 1, utilisation: 1, stable: false, erlangB: erlangB(n, a) };
  const b = erlangB(n, a);
  const c = b / (1 - rho * (1 - b));
  return { probabilityOfWait: Math.min(1, Math.max(0, c)), utilisation: rho, stable: true, erlangB: b };
}

/**
 * The fraction of contacts answered within `targetSeconds`.
 *
 * SL = 1 − C · e^(−(n − a)·T/AHT)
 *
 * @param {number} agents
 * @param {number} load erlangs
 * @param {number} ahtSeconds
 * @param {number} targetSeconds the answer threshold, e.g. 20
 */
export function serviceLevel(agents, load, ahtSeconds, targetSeconds) {
  const n = Math.max(0, Math.floor(agents));
  const a = Math.max(0, load);
  const aht = Math.max(1, ahtSeconds);
  const { probabilityOfWait, stable } = erlangC(n, a);
  if (!stable) return 0;
  return Math.min(1, Math.max(0, 1 - probabilityOfWait * Math.exp((-(n - a) * targetSeconds) / aht)));
}

/** Average speed of answer, in seconds. Infinite (returned as null) when the
    queue is unstable — "the average wait is 4 000 seconds" is a fiction. */
export function averageSpeedOfAnswer(agents, load, ahtSeconds) {
  const n = Math.max(0, Math.floor(agents));
  const a = Math.max(0, load);
  const { probabilityOfWait, stable } = erlangC(n, a);
  if (!stable) return null;
  return (probabilityOfWait * ahtSeconds) / (n - a);
}

/** Occupancy — the share of an agent's staffed time spent handling contacts.
    Sustained occupancy above ~85% is where attrition comes from, which is why
    `requiredAgents` can be told to cap it. */
export function occupancy(agents, load) {
  const n = Math.max(0, Math.floor(agents));
  if (n === 0) return load > 0 ? 1 : 0;
  return Math.min(1, load / n);
}

/* ── Requirement ───────────────────────────────────────────────────────────── */

/** A hard ceiling on the search so a pathological input cannot spin forever. */
const MAX_AGENTS = 10000;

/**
 * The smallest number of agents that meets the service target — on the phone,
 * before shrinkage.
 *
 * The occupancy cap is not decoration. Erlang C will happily answer "31 agents
 * hits 80/20" at 97% occupancy, which is a plan that burns a team out inside a
 * quarter and then misses the target anyway because the people it counted on
 * have left. Capping occupancy is how a staffing model stops being a headcount
 * model and starts being a plan someone can actually work.
 *
 * @param {object} p
 * @param {number} p.contacts contacts offered in the interval
 * @param {number} p.ahtSeconds
 * @param {number} [p.intervalMinutes]
 * @param {number} [p.targetSeconds] answer threshold, default 20
 * @param {number} [p.targetServiceLevel] 0..1, default 0.8
 * @param {number} [p.maxOccupancy] 0..1, default 0.85; pass 1 to disable
 * @returns {{agents: number, load: number, serviceLevel: number, occupancy: number, asa: number|null, cappedByOccupancy: boolean}}
 */
export function requiredAgents({
  contacts,
  ahtSeconds,
  intervalMinutes = DEFAULT_INTERVAL,
  targetSeconds = 20,
  targetServiceLevel = 0.8,
  maxOccupancy = 0.85,
}) {
  const load = offeredLoad(contacts, ahtSeconds, intervalMinutes);
  if (load <= 0) {
    return { agents: 0, load: 0, serviceLevel: 1, occupancy: 0, asa: 0, cappedByOccupancy: false };
  }

  // Start one above the load: at or below it the queue never clears.
  let n = Math.floor(load) + 1;
  let sl = serviceLevel(n, load, ahtSeconds, targetSeconds);
  while (sl < targetServiceLevel && n < MAX_AGENTS) {
    n += 1;
    sl = serviceLevel(n, load, ahtSeconds, targetSeconds);
  }

  const slAgents = n;
  const cap = Math.min(1, Math.max(0.01, maxOccupancy));
  // Adding agents only ever lowers occupancy, so the occupancy floor is a
  // closed form rather than another search.
  const occAgents = Math.ceil(load / cap);
  const agents = Math.max(slAgents, occAgents);

  return {
    agents,
    load,
    serviceLevel: serviceLevel(agents, load, ahtSeconds, targetSeconds),
    occupancy: occupancy(agents, load),
    asa: averageSpeedOfAnswer(agents, load, ahtSeconds),
    cappedByOccupancy: occAgents > slAgents,
  };
}

/**
 * Agents that must be *rostered* to have `onPhone` agents actually available.
 *
 * Shrinkage is a fraction of paid time not spent on the queue — breaks,
 * training, meetings, leave, absence. Dividing is correct and multiplying is
 * the classic error: at 30% shrinkage, 100 needed on the phone requires 143
 * rostered, not 130.
 */
export function rosteredFor(onPhone, shrinkage) {
  const s = Math.min(0.95, Math.max(0, Number(shrinkage) || 0));
  return Math.ceil(onPhone / (1 - s));
}

/**
 * Everything about one interval, with the working shown.
 *
 * @returns {{interval: string, contacts: number, load: number, onPhone: number, rostered: number,
 *            serviceLevel: number, occupancy: number, asa: number|null, cappedByOccupancy: boolean, shrinkage: number}}
 */
export function planInterval(row, opts = {}) {
  const intervalMinutes = opts.intervalMinutes ?? DEFAULT_INTERVAL;
  const shrinkage = opts.shrinkage ?? 0;
  const r = requiredAgents({
    contacts: row.contacts,
    ahtSeconds: row.ahtSeconds ?? opts.ahtSeconds,
    intervalMinutes,
    targetSeconds: opts.targetSeconds ?? 20,
    targetServiceLevel: opts.targetServiceLevel ?? 0.8,
    maxOccupancy: opts.maxOccupancy ?? 0.85,
  });
  return {
    interval: row.interval ?? "",
    contacts: Math.max(0, Number(row.contacts) || 0),
    load: r.load,
    onPhone: r.agents,
    rostered: rosteredFor(r.agents, shrinkage),
    serviceLevel: r.serviceLevel,
    occupancy: r.occupancy,
    asa: r.asa,
    cappedByOccupancy: r.cappedByOccupancy,
    shrinkage,
  };
}

/** A whole day's plan, interval by interval. */
export function planDay(rows, opts = {}) {
  return (rows ?? []).map((r) => planInterval(r, opts));
}

/* ── Shrinkage, measured ───────────────────────────────────────────────────── */

/**
 * Shrinkage derived from hours the system already holds, rather than a number
 * someone remembers.
 *
 * Returns the breakdown as well as the total, because "31%" is an argument and
 * "31%, of which 12 points is training this month" is a conversation.
 *
 * @param {{paidHours: number, breakHours?: number, trainingHours?: number,
 *          meetingHours?: number, leaveHours?: number, absenceHours?: number,
 *          otherHours?: number}} h
 * @returns {{shrinkage: number, lostHours: number, paidHours: number, parts: Array<{name: string, hours: number, share: number}>}}
 */
export function shrinkageFrom(h = {}) {
  const paid = Math.max(0, Number(h.paidHours) || 0);
  const named = [
    ["Breaks", h.breakHours],
    ["Training", h.trainingHours],
    ["Meetings", h.meetingHours],
    ["Leave", h.leaveHours],
    ["Absence", h.absenceHours],
    ["Other", h.otherHours],
  ];
  const parts = named
    .map(([name, v]) => ({ name, hours: Math.max(0, Number(v) || 0) }))
    .filter((p) => p.hours > 0);
  const lost = parts.reduce((s, p) => s + p.hours, 0);
  if (paid <= 0) return { shrinkage: 0, lostHours: lost, paidHours: 0, parts: parts.map((p) => ({ ...p, share: 0 })) };
  // Capped below 1: 100% shrinkage would make rosteredFor divide by zero, and a
  // day where every paid hour was lost is a data problem, not a plan.
  const shrinkage = Math.min(0.95, lost / paid);
  return {
    shrinkage,
    lostHours: lost,
    paidHours: paid,
    parts: parts.map((p) => ({ ...p, share: p.hours / paid })),
  };
}

/* ── Coverage ──────────────────────────────────────────────────────────────── */

/**
 * Planned versus required, interval by interval.
 *
 * Under and over are reported separately and never netted off. A day that is
 * six short at 10:00 and six long at 16:00 is not a balanced day — it is two
 * problems, and a single "net 0" figure is how both get missed.
 *
 * @param {Array<{interval: string, rostered: number}>} plan
 * @param {Record<string, number>} scheduled interval label -> agents scheduled
 */
export function coverage(plan, scheduled = {}) {
  const rows = (plan ?? []).map((p) => {
    const have = Math.max(0, Number(scheduled[p.interval]) || 0);
    const need = Math.max(0, Number(p.rostered) || 0);
    const diff = have - need;
    return {
      interval: p.interval,
      required: need,
      scheduled: have,
      difference: diff,
      state: diff < 0 ? "under" : diff > 0 ? "over" : "met",
    };
  });
  const under = rows.filter((r) => r.state === "under");
  const over = rows.filter((r) => r.state === "over");
  return {
    rows,
    understaffedIntervals: under.length,
    overstaffedIntervals: over.length,
    worstUnder: under.reduce((w, r) => (w === null || r.difference < w.difference ? r : w), null),
    agentHoursShort: under.reduce((s, r) => s + -r.difference, 0),
    agentHoursSpare: over.reduce((s, r) => s + r.difference, 0),
    covered: under.length === 0,
  };
}

/**
 * Whether one more absence can be afforded in a window — the question a leave
 * approval actually turns on, and the one currently answered by guesswork.
 *
 * Deliberately conservative: it reports the tightest interval in the window,
 * not the average. A request that leaves 09:00 fine and 14:00 two short is a
 * request that leaves the day two short.
 *
 * @param {ReturnType<typeof coverage>} cov
 * @param {string[]} intervals the interval labels the absence would cover
 * @param {number} [people] how many people are asking, default 1
 */
export function canAfford(cov, intervals, people = 1) {
  const want = new Set(intervals ?? []);
  const touched = (cov?.rows ?? []).filter((r) => want.has(r.interval));
  if (touched.length === 0) return { affordable: true, tightest: null, headroom: null, reason: "No planned intervals are affected." };
  const tightest = touched.reduce((w, r) => (r.difference < w.difference ? r : w), touched[0]);
  const headroom = tightest.difference;
  const affordable = headroom - people >= 0;
  return {
    affordable,
    tightest,
    headroom,
    reason: affordable
      ? `${headroom} spare at ${tightest.interval}, the tightest interval covered.`
      : headroom <= 0
        ? `${tightest.interval} is already ${-headroom} short.`
        : `${tightest.interval} has only ${headroom} spare and ${people} were requested.`,
  };
}

/* ── Explanation ───────────────────────────────────────────────────────────── */

/**
 * The working behind one interval's number, in sentences a planner can check.
 *
 * This exists because the first thing anyone does with a staffing tool is
 * disbelieve it. Being able to answer "because 420 contacts at 260 seconds is
 * 60.7 erlangs" is the difference between a tool that gets used and a tool that
 * gets overridden.
 */
export function explain(row, opts = {}) {
  const p = planInterval(row, opts);
  const aht = row.ahtSeconds ?? opts.ahtSeconds ?? 0;
  const mins = opts.intervalMinutes ?? DEFAULT_INTERVAL;
  const target = Math.round((opts.targetServiceLevel ?? 0.8) * 100);
  const seconds = opts.targetSeconds ?? 20;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const lines = [
    `${p.contacts} contacts in ${mins} minutes at ${aht}s handling time is ${p.load.toFixed(1)} erlangs of load.`,
    `${p.onPhone} agents on the queue reaches ${pct(p.serviceLevel)} answered within ${seconds}s, against a ${target}% target.`,
  ];
  if (p.cappedByOccupancy) {
    lines.push(`Service level alone needed fewer, but that would have run occupancy above the cap — ${p.onPhone} keeps it at ${pct(p.occupancy)}.`);
  } else {
    lines.push(`Occupancy at that staffing is ${pct(p.occupancy)}.`);
  }
  if (p.shrinkage > 0) {
    lines.push(`At ${pct(p.shrinkage)} shrinkage, ${p.rostered} must be rostered to have ${p.onPhone} on the queue.`);
  }
  return { ...p, lines };
}

/* ── Sanity checks ─────────────────────────────────────────────────────────── */

/**
 * Problems with a forecast that would make its output meaningless — returned as
 * sentences rather than thrown, because a planner pasting a spreadsheet needs to
 * be told which row is wrong, not handed a stack trace.
 *
 * @returns {string[]} empty when the forecast is usable
 */
export function checkForecast(rows, opts = {}) {
  const problems = [];
  const list = rows ?? [];
  if (list.length === 0) return ["The forecast has no intervals."];
  const seen = new Set();
  for (const r of list) {
    const at = r.interval || "(no interval)";
    if (!r.interval) problems.push("A row has no interval.");
    else if (seen.has(r.interval)) problems.push(`${at} appears more than once.`);
    seen.add(r.interval);
    const c = Number(r.contacts);
    if (!Number.isFinite(c) || c < 0) problems.push(`${at} has an unusable contact volume.`);
    const aht = Number(r.ahtSeconds ?? opts.ahtSeconds);
    if (!Number.isFinite(aht) || aht <= 0) problems.push(`${at} has no handling time.`);
    else if (aht > 3600) problems.push(`${at} has a handling time over an hour — check the units are seconds.`);
  }
  const t = opts.targetServiceLevel;
  if (t !== undefined && (!(t > 0) || t >= 1)) problems.push("The service level target must be between 0 and 1.");
  return problems;
}

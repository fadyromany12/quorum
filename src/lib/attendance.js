/* Login / logout / AUX state tracking — pure, no I/O.

   The agent-facing clock: an agent logs in, moves between AUX states through the
   shift, and logs out. Everything downstream — adherence, break compliance,
   productive time, payroll hours — is derived from that one stream.

   ── Events are the truth, state is derived ──────────────────────────────────
   Nothing here mutates a "current status" column. Punches and AUX changes are
   append-only events, and the current state is computed from the last one. Three
   reasons, all learned the hard way:

     · Concurrency. Two requests arriving together (a double-tap, a retry after a
       timeout, a second browser tab) cannot corrupt a state they only append to.
       A read-modify-write on a status column loses one of them silently.
     · Disputes. "You were on break for 40 minutes" has to be answerable with
       the actual sequence, months later, not with a number nobody can re-derive.
     · Rule changes. When a break policy changes, the history can be replayed
       under the new rule instead of being wrong or needing a migration.

   ── Time discipline ────────────────────────────────────────────────────────
   Instants are epoch milliseconds and are **server-assigned**. A client clock is
   never trusted: it can be wrong by hours, and it can be set deliberately.

   Calendar days are derived from an instant in the operating time zone, never
   from the instant's UTC date. Egypt observes DST again (since 2023), so a shift
   crossing the boundary sits in a 23- or 25-hour day. Anything that treated a
   local day as a fixed 86 400 000 ms offset from UTC would be an hour out twice
   a year, and would silently mis-bucket an overnight shift. */

/* ── AUX codes ──────────────────────────────────────────────────────────────
   `productive` counts toward occupancy. `paid` counts toward payroll hours.
   Lunch is the usual case where those two differ, and conflating them is how a
   headline "hours worked" figure ends up overstating the paybill.

   The definitions live in taxonomy.js with every other reason the system
   records, and are re-exported here under the name this module has always used.
   One list: a second copy of "what an agent can be doing" is a second answer to
   "were they adherent". */
export { ACTIVITY_STATES as AUX_CODES } from "./taxonomy.js";
import { ACTIVITY_STATES } from "./taxonomy.js";

export const AUX_LIST = Object.keys(ACTIVITY_STATES);
const AUX_CODES = ACTIVITY_STATES;
export const isAux = (a) => Object.hasOwn(AUX_CODES, a);

/** The state an agent lands in on login, and returns to when leaving an AUX. */
export const DEFAULT_AUX = "Available";

export const EVENT_TYPES = ["LOGIN", "LOGOUT", "AUX"];

/* Why a logout happened. A system logout is not the agent's doing and must be
   distinguishable — it is evidence of an abandoned session, not of an agent who
   left properly, and adherence should not punish the two identically. */
export const LOGOUT_SOURCES = ["agent", "supervisor", "system"];

/* ── Policy ─────────────────────────────────────────────────────────────────*/
export const ATTENDANCE_POLICY = {
  // A session open longer than this was abandoned; the sweeper closes it.
  maxSessionSeconds: 16 * 3600,
  // Identical punches inside this window are treated as one. Covers the
  // double-tap and the client retrying a request that actually succeeded.
  duplicateWindowSeconds: 5,
  // Grace before a late login counts as late.
  lateGraceSeconds: 300,
  // Break must start within this window around its scheduled slot.
  breakWindowSeconds: 30 * 60,
};

/* ── Ordering ───────────────────────────────────────────────────────────────*/

const at = (e) => Number(e?.at);

/** Chronological, with a stable tiebreak so equal stamps never reorder. */
export function ordered(events) {
  return (events || [])
    .filter((e) => Number.isFinite(at(e)) && EVENT_TYPES.includes(e.type))
    .sort((a, b) => at(a) - at(b) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
}

/* ── Current state ──────────────────────────────────────────────────────────*/

/**
 * Where the agent is right now, derived from the stream.
 *
 * @param {Array<object>} events
 * @param {number} nowMs
 * @returns {{loggedIn: boolean, aux: string|null, since: number|null,
 *            sessionStart: number|null, seconds: number}}
 */
export function currentState(events, nowMs) {
  const list = ordered(events);
  let loggedIn = false;
  let aux = null;
  let since = null;
  let sessionStart = null;

  for (const e of list) {
    if (e.type === "LOGIN") {
      // A LOGIN while already in is a no-op, not a new session: honouring it
      // would silently discard the time already accrued.
      if (!loggedIn) {
        loggedIn = true;
        sessionStart = at(e);
        aux = isAux(e.aux) ? e.aux : DEFAULT_AUX;
        since = at(e);
      }
    } else if (e.type === "LOGOUT") {
      loggedIn = false;
      aux = null;
      since = null;
      sessionStart = null;
    } else if (e.type === "AUX" && loggedIn && isAux(e.aux)) {
      // Re-selecting the current state should not reset its elapsed timer —
      // otherwise an agent could sit on Break indefinitely by re-clicking it.
      if (e.aux !== aux) {
        aux = e.aux;
        since = at(e);
      }
    }
  }

  return {
    loggedIn,
    aux,
    since,
    sessionStart,
    seconds: since === null ? 0 : Math.max(0, Math.floor((nowMs - since) / 1000)),
  };
}

/* ── Intervals ──────────────────────────────────────────────────────────────*/

/**
 * The stream as closed intervals. The final interval of an open session is
 * closed at `nowMs` and flagged `open`, so a live dashboard and a historical
 * report share one code path.
 *
 * @returns {Array<{aux: string, from: number, to: number, seconds: number,
 *                  sessionStart: number, open: boolean}>}
 */
export function intervals(events, nowMs) {
  const list = ordered(events);
  const out = [];
  let loggedIn = false;
  let aux = null;
  let since = null;
  let sessionStart = null;

  const close = (to) => {
    if (!loggedIn || since === null || to <= since) return;
    out.push({ aux, from: since, to, seconds: Math.floor((to - since) / 1000), sessionStart, open: false });
  };

  for (const e of list) {
    const t = at(e);
    if (e.type === "LOGIN") {
      if (loggedIn) continue;
      loggedIn = true;
      sessionStart = t;
      aux = isAux(e.aux) ? e.aux : DEFAULT_AUX;
      since = t;
    } else if (e.type === "LOGOUT") {
      if (!loggedIn) continue;
      close(t);
      loggedIn = false;
      aux = null;
      since = null;
      sessionStart = null;
    } else if (e.type === "AUX") {
      if (!loggedIn || !isAux(e.aux) || e.aux === aux) continue;
      close(t);
      aux = e.aux;
      since = t;
    }
  }

  if (loggedIn && since !== null && nowMs > since) {
    out.push({
      aux, from: since, to: nowMs,
      seconds: Math.floor((nowMs - since) / 1000),
      sessionStart, open: true,
    });
  }

  return out;
}

/** Seconds per AUX code. Codes never entered are absent, not zero. */
export function tallyByAux(list) {
  const out = {};
  for (const i of list) out[i.aux] = (out[i.aux] || 0) + i.seconds;
  return out;
}

/**
 * Shift totals. `paidSeconds` deliberately excludes unpaid codes — reporting
 * total logged-in time as hours worked overstates the paybill by every lunch.
 */
export function summarise(list) {
  let loggedIn = 0, productive = 0, paid = 0;
  for (const i of list) {
    const meta = AUX_CODES[i.aux];
    loggedIn += i.seconds;
    if (meta?.productive) productive += i.seconds;
    if (meta?.paid) paid += i.seconds;
  }
  return {
    loggedInSeconds: loggedIn,
    productiveSeconds: productive,
    paidSeconds: paid,
    unpaidSeconds: loggedIn - paid,
    // Occupancy against logged-in time, one decimal place. Zero time is 0%
    // rather than NaN — a shift that has not started is not a division error.
    occupancyPct: loggedIn === 0 ? 0 : Math.round((productive / loggedIn) * 1000) / 10,
    byAux: tallyByAux(list),
  };
}

/* ── Validation ─────────────────────────────────────────────────────────────*/

/**
 * Whether a punch is allowed, and why not.
 *
 * Returns a reason instead of throwing so a route can hand it straight to the
 * agent, and returns `duplicate: true` for a repeat rather than an error —
 * a double-tap or a retried request is not the agent doing something wrong, and
 * answering 400 to it trains people to punch twice.
 *
 * @param {Array<object>} events
 * @param {{type: string, aux?: string}} punch
 * @param {number} nowMs server time
 * @param {typeof ATTENDANCE_POLICY} [policy]
 * @returns {{ok: true, duplicate?: boolean} | {ok: false, reason: string}}
 */
export function checkPunch(events, punch, nowMs, policy = ATTENDANCE_POLICY) {
  const type = punch?.type;
  if (!EVENT_TYPES.includes(type)) return { ok: false, reason: "Unknown punch type." };

  const state = currentState(events, nowMs);
  const list = ordered(events);
  const last = list[list.length - 1];

  // Idempotency first: an identical punch inside the window is the same punch.
  if (last && at(last) >= nowMs - policy.duplicateWindowSeconds * 1000) {
    const sameAux = (last.aux ?? null) === (punch.aux ?? null);
    if (last.type === type && (type !== "AUX" || sameAux)) return { ok: true, duplicate: true };
  }

  if (type === "LOGIN") {
    if (state.loggedIn) return { ok: false, reason: "You are already logged in." };
    if (punch.aux && !isAux(punch.aux)) return { ok: false, reason: `Unknown state "${punch.aux}".` };
    return { ok: true };
  }

  if (type === "LOGOUT") {
    if (!state.loggedIn) return { ok: false, reason: "You are not logged in." };
    return { ok: true };
  }

  // AUX
  if (!state.loggedIn) return { ok: false, reason: "Log in before changing your state." };
  if (!isAux(punch.aux)) return { ok: false, reason: `Unknown state "${punch.aux}".` };
  // Not an error — selecting the state you are already in changes nothing, and
  // treating it as a duplicate keeps the elapsed timer honest.
  if (punch.aux === state.aux) return { ok: true, duplicate: true };
  return { ok: true };
}

/* ── Compliance ─────────────────────────────────────────────────────────────*/

/**
 * Policy breaches in one shift's intervals.
 *
 * Reports rather than blocks: an agent already 20 minutes into a 15-minute break
 * cannot be un-broken, and refusing their return punch would only make the
 * overrun worse. Enforcement is a conversation, so this produces the evidence
 * for one.
 *
 * An open interval is measured as it stands — a break currently running over is
 * a breach now, not once the agent happens to come back.
 *
 * @returns {Array<{aux: string, kind: "over_limit"|"too_many", seconds?: number,
 *                  limitSeconds?: number, count?: number, maxPerShift?: number,
 *                  from?: number, open?: boolean}>}
 */
export function breaches(list, codes = AUX_CODES) {
  const out = [];
  const counts = {};

  for (const i of list) {
    const meta = codes[i.aux];
    if (!meta) continue;
    counts[i.aux] = (counts[i.aux] || 0) + 1;
    if (meta.limitSeconds && i.seconds > meta.limitSeconds) {
      out.push({
        aux: i.aux, kind: "over_limit",
        seconds: i.seconds, limitSeconds: meta.limitSeconds,
        overBy: i.seconds - meta.limitSeconds,
        from: i.from, open: i.open,
      });
    }
  }

  for (const [aux, count] of Object.entries(counts)) {
    const meta = codes[aux];
    if (meta?.maxPerShift && count > meta.maxPerShift) {
      out.push({ aux, kind: "too_many", count, maxPerShift: meta.maxPerShift });
    }
  }

  return out;
}

/* ── Adherence ──────────────────────────────────────────────────────────────*/

/**
 * Adherence against a scheduled window.
 *
 * Measured as overlap between paid presence and the schedule, in both
 * directions: time inside the window counts toward adherence, and time worked
 * outside it is reported separately rather than credited. Crediting unscheduled
 * time is how a system rewards an agent for working the wrong hours.
 *
 * Instants throughout, so an overnight shift and a DST boundary need no special
 * case — a shift is a pair of instants, not a pair of clock times.
 *
 * @param {Array<object>} list intervals
 * @param {{start: number, end: number}} shift instants
 */
export function adherence(list, shift) {
  if (!shift || !Number.isFinite(shift.start) || !Number.isFinite(shift.end) || shift.end <= shift.start) {
    return { scheduledSeconds: 0, inWindowSeconds: 0, outOfWindowSeconds: 0, adherencePct: null, lateBySeconds: null };
  }
  const scheduled = Math.floor((shift.end - shift.start) / 1000);
  let inWindow = 0;
  let outOfWindow = 0;
  let firstPresence = null;

  for (const i of list) {
    const meta = AUX_CODES[i.aux];
    if (!meta?.paid) continue; // unpaid time is not presence
    if (firstPresence === null || i.from < firstPresence) firstPresence = i.from;
    const lo = Math.max(i.from, shift.start);
    const hi = Math.min(i.to, shift.end);
    const overlap = Math.max(0, Math.floor((hi - lo) / 1000));
    inWindow += overlap;
    outOfWindow += i.seconds - overlap;
  }

  return {
    scheduledSeconds: scheduled,
    inWindowSeconds: inWindow,
    outOfWindowSeconds: outOfWindow,
    // Capped at 100: presence cannot exceed the schedule it is measured against.
    adherencePct: Math.min(100, Math.round((inWindow / scheduled) * 1000) / 10),
    lateBySeconds: firstPresence === null ? null : Math.max(0, Math.floor((firstPresence - shift.start) / 1000)),
  };
}

/** True when a late login exceeds the grace period. */
export function isLate(adherenceResult, policy = ATTENDANCE_POLICY) {
  const late = adherenceResult?.lateBySeconds;
  return Number.isFinite(late) && late > policy.lateGraceSeconds;
}

/* ── Abandoned sessions ─────────────────────────────────────────────────────*/

/**
 * Whether an open session has outlived the maximum and should be closed by the
 * sweeper.
 *
 * The logout is stamped at the session's deadline, not at the moment the sweeper
 * happens to run — otherwise how long an agent appears to have worked depends on
 * cron timing, and a job that runs late pays them for the delay.
 *
 * @returns {{stale: true, logoutAt: number, openSeconds: number} | {stale: false}}
 */
export function staleSession(events, nowMs, policy = ATTENDANCE_POLICY) {
  const state = currentState(events, nowMs);
  if (!state.loggedIn || state.sessionStart === null) return { stale: false };
  const openSeconds = Math.floor((nowMs - state.sessionStart) / 1000);
  if (openSeconds <= policy.maxSessionSeconds) return { stale: false };
  return {
    stale: true,
    logoutAt: state.sessionStart + policy.maxSessionSeconds * 1000,
    openSeconds,
  };
}

/* ── Local calendar days ────────────────────────────────────────────────────*/

/**
 * The local calendar day an instant falls on, in a named time zone.
 *
 * Uses Intl rather than arithmetic on a fixed offset, because Egypt observes DST
 * again and the offset is not constant. Deriving a local day by adding a stored
 * offset to UTC is wrong for two weeks a year and silently mis-buckets any
 * overnight shift that crosses the change.
 */
export function localDay(ms, timeZone = "Africa/Cairo") {
  if (!Number.isFinite(ms)) return "";
  // en-CA formats as YYYY-MM-DD, which is the shape the rest of the app uses.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

/**
 * Group intervals into shifts, keyed by the local day the **session started**.
 *
 * Keyed on the session start rather than each interval's own day so an overnight
 * shift stays one shift instead of splitting across midnight into two — a night
 * agent's break should not be reported against tomorrow.
 */
export function shiftsByDay(list, timeZone = "Africa/Cairo") {
  const out = new Map();
  for (const i of list) {
    const key = localDay(i.sessionStart, timeZone);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(i);
  }
  return out;
}

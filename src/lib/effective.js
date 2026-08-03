/* Effective-dated records — pure, no I/O, reusable across every dated fact.

   The rule: HR facts are never updated in place. A change inserts a new version
   stamped with the day it takes effect, and the series *is* the history. Salary,
   job, grade, org placement, reporting line and policy assignment all work this
   way; a phone-number correction does not, because that is not history.

   ── Why no end date ──────────────────────────────────────────────────────────
   A version carries only `effectiveFrom`. Its validity ends where the next one
   begins, so overlaps and gaps are impossible by construction rather than by
   constraint — there is no second field to fall out of step with the first, and
   no maintenance write on the previous row when a new one is inserted. End dates
   are derived for display (see `series`), never stored.

   ── Two different dates ──────────────────────────────────────────────────────
   `effectiveFrom` is when a fact becomes true in the world.
   `recordedAt`    is when this system was told.

   They are genuinely different, and conflating them makes retroactive
   corrections unrepresentable. A raise agreed in March but backdated to January
   has effectiveFrom = January, recordedAt = March. Payroll needs both: January
   to compute what should have been paid, March to explain why the arrears appear
   in the March run and not before.

   Keeping both also answers "what did we believe on the day we paid them?" —
   pass `knownAt` to reconstruct the state as of a past instant, which is the
   only honest way to audit a payment that was correct given what was known.

   ── Corrections ─────────────────────────────────────────────────────────────
   Two versions may share an effectiveFrom. The later-recorded one governs. That
   is how a wrong figure is fixed without destroying the evidence that it was
   once believed — the superseded row stays readable, and `voided` retracts an
   entry that should never have existed at all. Nothing is ever deleted. */

import { parseDay, addDays } from "./dates.js";

/** Sort key: earlier effect first, then earlier knowledge first. */
function order(a, b) {
  const ea = parseDay(a.effectiveFrom);
  const eb = parseDay(b.effectiveFrom);
  if (ea !== eb) return ea - eb;
  const ra = new Date(a.recordedAt ?? 0).getTime();
  const rb = new Date(b.recordedAt ?? 0).getTime();
  if (ra !== rb) return ra - rb;
  // Final tiebreak so equal stamps produce a stable, reproducible order.
  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

const isUsable = (v) => !v?.voided && !Number.isNaN(parseDay(v?.effectiveFrom));

/**
 * Versions that count, oldest first.
 * @param {Array<object>} versions
 * @param {{knownAt?: string|number|Date}} [opts] ignore anything recorded later
 */
export function usable(versions, { knownAt } = {}) {
  const cutoff = knownAt === undefined ? null : new Date(knownAt).getTime();
  return (versions || [])
    .filter(isUsable)
    .filter((v) => {
      if (cutoff === null) return true;
      const rec = new Date(v.recordedAt ?? 0).getTime();
      return rec <= cutoff;
    })
    .sort(order);
}

/**
 * The version in force on a given calendar day, or null when the series does
 * not reach back that far.
 *
 * @param {Array<object>} versions
 * @param {string} day YYYY-MM-DD
 * @param {{knownAt?: string|number|Date}} [opts] as the system understood it then
 */
export function governing(versions, day, opts) {
  const d = parseDay(day);
  if (Number.isNaN(d)) return null;
  const list = usable(versions, opts);
  let winner = null;
  for (const v of list) {
    if (parseDay(v.effectiveFrom) > d) break; // sorted, so nothing later applies
    winner = v; // later rows with the same effectiveFrom legitimately supersede
  }
  return winner;
}

/**
 * One field's value on a day. Returns `fallback` when nothing governs — which
 * is a real answer for someone whose record starts after the date asked about,
 * not an error.
 */
export function valueAt(versions, day, field, fallback = null) {
  const v = governing(versions, day);
  return v ? (v[field] ?? fallback) : fallback;
}

/**
 * The series as a reader sees it: one entry per distinct effective date, with
 * `effectiveTo` derived (inclusive, "" while open-ended) and superseded
 * corrections collapsed away.
 *
 * Derived rather than stored precisely so it cannot disagree with the versions
 * it summarises.
 */
export function series(versions, opts) {
  const list = usable(versions, opts);

  // Collapse same-day corrections: last recorded for a given day wins.
  const byDay = new Map();
  for (const v of list) byDay.set(v.effectiveFrom, v);
  const kept = [...byDay.values()].sort(order);

  return kept.map((v, i) => {
    const next = kept[i + 1];
    return {
      ...v,
      effectiveTo: next ? addDays(next.effectiveFrom, -1) : "",
      current: false, // set by `withCurrent`
    };
  });
}

/** `series`, with the entry in force on `today` flagged. */
export function withCurrent(versions, today, opts) {
  const rows = series(versions, opts);
  const now = governing(versions, today, opts);
  return rows.map((r) => ({ ...r, current: !!now && r.effectiveFrom === now.effectiveFrom }));
}

/**
 * Versions dated after `today` — changes already agreed but not yet in force.
 *
 * Worth surfacing prominently: a future-dated raise or transfer is invisible on
 * a plain "current value" read, and an approver who cannot see it will happily
 * approve a second one on top.
 */
export function scheduled(versions, today, opts) {
  const t = parseDay(today);
  if (Number.isNaN(t)) return [];
  return usable(versions, opts).filter((v) => parseDay(v.effectiveFrom) > t);
}

/**
 * Consecutive changes as from → to pairs, for a timeline or a diff view.
 * @param {Array<object>} versions
 * @param {string[]} fields which fields to report on
 */
export function changeLog(versions, fields, opts) {
  const rows = series(versions, opts);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    const prev = rows[i - 1];
    const changes = [];
    for (const f of fields) {
      const from = prev ? prev[f] : undefined;
      const to = cur[f];
      // On the first version everything is a change from nothing; after that,
      // only report fields that actually moved.
      if (prev && String(from ?? "") === String(to ?? "")) continue;
      changes.push({ field: f, from: from ?? null, to: to ?? null });
    }
    if (changes.length) {
      out.push({ effectiveFrom: cur.effectiveFrom, recordedAt: cur.recordedAt ?? null, reason: cur.reason ?? "", changes, version: cur });
    }
  }
  return out;
}

/**
 * Whether a proposed version can be inserted, and why not.
 *
 * Deliberately permissive about the past: backdating is legitimate and common,
 * and refusing it would leave corrections nowhere to go. What it does refuse is
 * a duplicate that changes nothing — an identical version on a date already
 * covered adds a row to every history view and answers no question.
 *
 * @param {Array<object>} versions existing series
 * @param {object} proposed must carry effectiveFrom
 * @param {string[]} fields the fields that constitute a real change
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkInsert(versions, proposed, fields = []) {
  if (Number.isNaN(parseDay(proposed?.effectiveFrom))) {
    return { ok: false, reason: "An effective date is required (YYYY-MM-DD)." };
  }
  const prior = governing(versions, proposed.effectiveFrom);
  if (prior && fields.length) {
    const identical = fields.every((f) => String(prior[f] ?? "") === String(proposed[f] ?? ""));
    if (identical) {
      return { ok: false, reason: `Nothing changes — those values already apply from ${prior.effectiveFrom}.` };
    }
  }
  return { ok: true };
}

/**
 * Days in [from, to] where a value differs from what a later correction says it
 * should have been — the window arrears are owed for.
 *
 * Returns the two governing versions rather than a figure: money is the
 * caller's to compute, and this module deliberately knows nothing about it.
 */
export function retroWindow(versions, from, to, { knownAt } = {}) {
  const believed = governing(versions, from, { knownAt });
  const actual = governing(versions, from);
  if (!believed || !actual) return null;
  if (believed.id === actual.id) return null;
  return { from, to, believed, actual };
}

/* What is waiting on you — assembled, not stored.

   The app is entirely pull today: approvals sit in a queue, acknowledgements sit
   unsigned, warnings lapse, cases pass their SLA, and every one of those is
   visible only to someone who remembers to go and look. The cost is not that
   the information is missing; it is that noticing is a habit rather than a
   feature, and habits are uneven.

   ── Why there is no Notification table ────────────────────────────────────

   The obvious build is a table, a row written whenever something happens, and a
   read flag. It is also the wrong one here, for a reason this codebase already
   takes seriously everywhere else: a stored notification is a copy, and a copy
   drifts. Approve the request from the approvals screen and the notification
   about it is still sitting there unread, describing a world that no longer
   exists. Then someone has to write the code that deletes it, and that code has
   to be called from every path that could resolve the underlying thing, and the
   day one path forgets is the day the bell starts lying.

   Deriving it on read cannot drift, because there is nothing to drift from. The
   item exists exactly as long as the thing it describes needs doing.

   The honest cost: there is no read/unread, because there is nothing to mark
   read. This is a work queue, not a message inbox. For this product that is the
   better shape anyway — "3 approvals waiting" is a more useful sentence than
   "3 unread", and an item leaves when the work is done rather than when someone
   has glanced at it. It also means no migration, which is why the bell can ship
   without a schema change behind it. */

/** Each kind of waiting work, with where it lives and how loudly it should read. */
export const INBOX_KINDS = {
  /* Two different queues on two different screens, and conflating them was the
     first thing this got wrong: the bell reported no approvals while the
     sidebar badge said six, because "My approvals" renders case sign-offs and
     the request approvals live under Requests. A bell that measures a different
     thing from the screen it points at is the drift this design exists to
     avoid, so both are counted, separately, each linking where it is actioned. */
  signoff: {
    label: "Cases waiting for your sign-off",
    tab: "approvals",
    weight: 100,
  },
  approval: {
    label: "Requests waiting on your decision",
    tab: "requests",
    weight: 98,
  },
  /* Above both approval queues, because a person waiting on this cannot sign
     in at all. Every other item on this list is somebody inconvenienced; this
     one is somebody who has started a job and cannot open the door. */
  application: {
    label: "New joiners waiting for your approval",
    tab: "joining",
    weight: 105,
  },
  acknowledgement: {
    label: "Waiting for your signature",
    tab: null, // agents have no workspace tabs; this lives in the portal
    weight: 95,
  },
  slaBreach: {
    label: "Past its SLA",
    tab: "triage",
    weight: 90,
  },
  review: {
    label: "New cases to review",
    tab: "triage",
    weight: 70,
  },
  expiring: {
    label: "Warnings lapsing soon",
    tab: "log",
    weight: 40,
  },
  incomplete: {
    label: "Your record is missing something payroll needs",
    tab: null,
    weight: 60,
  },
};

export const INBOX_CODES = Object.keys(INBOX_KINDS);
export const isInboxKind = (k) => Object.hasOwn(INBOX_KINDS, k);

/**
 * Build the ranked list from already-counted sources.
 *
 * Takes counts rather than records: the bell says how many and where, and the
 * screen it sends you to is the thing that renders the detail. Passing whole
 * records through here would put a second, thinner copy of every list behind a
 * dropdown, and the two would disagree the first time one of them was filtered.
 *
 * @param {Record<string, {count: number, detail?: string}>} sources
 * @returns {{items: Array<object>, total: number}}
 */
export function buildInbox(sources = {}) {
  const items = [];
  for (const [kind, meta] of Object.entries(INBOX_KINDS)) {
    const src = sources[kind];
    const count = Number(src?.count) || 0;
    if (count <= 0) continue;
    items.push({
      kind,
      label: meta.label,
      tab: meta.tab,
      count,
      weight: meta.weight,
      ...(src.detail ? { detail: src.detail } : {}),
    });
  }
  items.sort((a, b) => b.weight - a.weight || a.kind.localeCompare(b.kind));
  return { items, total: items.reduce((n, i) => n + i.count, 0) };
}

/**
 * Everything wrong with this module's own wiring — a kind pointing at a screen
 * the navigation does not place, or two kinds claiming the same priority.
 *
 * The tie matters more than it looks: two items with equal weight fall back to
 * alphabetical order, so "approval" would outrank "slaBreach" for no reason
 * anyone chose, and the order of the list is the only thing telling the reader
 * what to do first.
 *
 * @param {string[]} navOrder tab ids the navigation places
 */
export function checkInbox(navOrder = []) {
  const problems = [];
  const tabs = new Set(navOrder);
  const weights = new Map();
  for (const [kind, meta] of Object.entries(INBOX_KINDS)) {
    if (!meta.label) problems.push(`${kind} has no label.`);
    if (meta.tab && tabs.size && !tabs.has(meta.tab)) {
      problems.push(`${kind} points at screen "${meta.tab}", which the navigation does not place.`);
    }
    if (!Number.isFinite(meta.weight)) problems.push(`${kind} has no weight, so its position would be arbitrary.`);
    else if (weights.has(meta.weight)) {
      problems.push(`${kind} and ${weights.get(meta.weight)} share weight ${meta.weight}, so their order is alphabetical rather than chosen.`);
    } else weights.set(meta.weight, kind);
  }
  return problems;
}

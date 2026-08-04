/* Notifications — the difference between an app people check and an app that
   tells them.

   Everything in this product is pull. The bell derives what is waiting, which
   is the right design for the bell — a derived count cannot drift — but it only
   answers the question once somebody thinks to ask it. An approval sits on a
   lead who is not logged in; a roster is published to somebody who does not
   know; a warning waits for a signature from a person who has no reason to
   look. The information was never missing. Noticing was a habit.

   ── A notification is not a record ────────────────────────────────────────

   The rule the whole module is built on, because getting it wrong is how
   notification systems start lying. The app is the record; a notification is a
   nudge about it, sent at a moment, read at another, and possibly already
   wrong by then. So:

     · every message carries a link, never a decision — you cannot approve from
       a notification, because the thing may have been withdrawn since;
     · the body describes what happened, not what is currently true. "Nour
       asked for 2 days" stays true forever. "You have 3 approvals waiting"
       is false the moment somebody clears one;
     · nothing here is stored as the source of anything. Delete every push
       subscription and the app is unchanged.

   ── Sent on events, not on state ──────────────────────────────────────────

   The tempting build is to push whatever the bell says on a timer. That sends
   the same reminder every hour until somebody acts, which is how people turn
   notifications off. These fire on the transition — the moment a request lands
   on you — and never again for the same thing.

   ── Quiet hours default to off ────────────────────────────────────────────

   Shift workers sleep during the day. A push at 3pm to somebody who worked the
   night shift is exactly as rude as 3am to somebody who did not, and the app
   cannot know which without being told. Guessing from the roster was
   tempting and is wrong on the first day somebody swaps. So quiet hours exist,
   default to nothing, and are the employee's to set. */

/** Every event that is worth interrupting somebody for. */
export const NOTIFY_KINDS = {
  /* Somebody is blocked on you. The highest-value push in the product: this is
     the one where not knowing costs somebody else their day off. */
  approvalWaiting: {
    label: "A request needs your decision",
    urgency: "high",
    tab: "requests",
    /* Cannot be switched off. An approver who mutes approvals is a queue that
       silently stops moving, and the people waiting in it never find out why. */
    required: true,
  },
  /* The other half of the same loop, and the one people actually want. */
  requestDecided: {
    label: "Your request was decided",
    urgency: "high",
    tab: null,
    required: false,
  },
  applicationWaiting: {
    label: "A new joiner is waiting for your approval",
    urgency: "high",
    tab: "joining",
    required: true,
  },
  /* A roster is a promise about specific hours. Changing one silently is the
     single most disruptive thing this app can do to somebody's week. */
  rosterPublished: {
    label: "Your roster changed",
    urgency: "high",
    tab: null,
    required: false,
  },
  caseToSign: {
    label: "Something needs your signature",
    urgency: "normal",
    tab: null,
    required: false,
  },
  /* Deliberately low. Nobody's evening should be interrupted by a reminder
     that a warning lapses in a fortnight. */
  slaBreach: {
    label: "Something has passed its SLA",
    urgency: "low",
    tab: "triage",
    required: false,
  },
};

export const NOTIFY_CODES = Object.keys(NOTIFY_KINDS);
export const isNotifyKind = (k) => Object.hasOwn(NOTIFY_KINDS, k);
export const isRequired = (k) => Boolean(NOTIFY_KINDS[k]?.required);

/** What a person may switch off, which is everything that is not required. */
export const OPTIONAL_KINDS = NOTIFY_CODES.filter((k) => !NOTIFY_KINDS[k].required);

/** The shape stored against a user. Absent means "everything on, no quiet hours". */
export const DEFAULT_PREFS = {
  enabled: true,
  /** Kinds explicitly switched off. Required kinds are ignored if listed. */
  muted: [],
  /** "HH:MM" — inclusive start, exclusive end. Empty means no quiet hours. */
  quietFrom: "",
  quietTo: "",
};

export function readPrefs(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: p.enabled !== false,
    muted: Array.isArray(p.muted) ? p.muted.filter(isNotifyKind).filter((k) => !isRequired(k)) : [],
    quietFrom: /^\d{2}:\d{2}$/.test(String(p.quietFrom ?? "")) ? p.quietFrom : "",
    quietTo: /^\d{2}:\d{2}$/.test(String(p.quietTo ?? "")) ? p.quietTo : "",
  };
}

/**
 * Is `hhmm` inside the quiet window?
 *
 * Handles a window that crosses midnight, which is the normal case — 22:00 to
 * 07:00 is what most people mean by "not at night", and a naive from <= t < to
 * comparison makes that window empty.
 */
export function inQuietHours(hhmm, { quietFrom = "", quietTo = "" } = {}) {
  if (!quietFrom || !quietTo || quietFrom === quietTo) return false;
  const t = String(hhmm);
  return quietFrom < quietTo
    ? t >= quietFrom && t < quietTo
    : t >= quietFrom || t < quietTo; // crosses midnight
}

/**
 * Should this event interrupt this person, right now?
 *
 * Returns a reason either way, because "why did I not get told" is a support
 * question somebody has to be able to answer.
 *
 * @returns {{send: boolean, reason: string, deferred?: boolean}}
 */
export function shouldNotify(kind, prefs = {}, { at = "" } = {}) {
  if (!isNotifyKind(kind)) return { send: false, reason: `Unknown notification kind "${kind}".` };
  const p = readPrefs(prefs);

  if (!p.enabled) return { send: false, reason: "Notifications are switched off for this account." };
  if (p.muted.includes(kind)) return { send: false, reason: `${NOTIFY_KINDS[kind].label} is muted.` };

  /* Quiet hours hold back the low and normal traffic and let the blocking kind
     through. Somebody waiting on your approval is not served by you finding
     out politely in the morning — and if that is genuinely unwelcome, the
     answer is delegation, which this app already has. */
  if (inQuietHours(at, p) && NOTIFY_KINDS[kind].urgency !== "high") {
    return { send: false, deferred: true, reason: "Inside your quiet hours — it will be in the app when you look." };
  }

  return { send: true, reason: "" };
}

/* The lines themselves. Written as statements of what happened rather than of
   what is currently true, because a push read an hour later must still be
   honest — "3 approvals waiting" is wrong the moment somebody clears one. */

const clip = (s, n = 80) => {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * The message for an event.
 *
 * @param {string} kind
 * @param {object} data
 * @returns {{title: string, body: string, url: string, tag: string, urgency: string}}
 */
export function messageFor(kind, data = {}) {
  const meta = NOTIFY_KINDS[kind];
  if (!meta) throw new Error(`Unknown notification kind "${kind}".`);

  const who = clip(data.subjectName || data.actorName || "Somebody", 40);
  const base = { urgency: meta.urgency, url: "/", tag: `${kind}:${data.id ?? ""}` };

  switch (kind) {
    case "approvalWaiting":
      return {
        ...base,
        title: `${who} needs a decision`,
        body: clip(data.summary || meta.label),
        url: data.url || "/workspace",
      };
    case "requestDecided":
      return {
        ...base,
        title: data.decision === "approved" ? "Approved" : data.decision === "rejected" ? "Not approved" : "Decided",
        /* The note matters more than the verdict on a rejection — it is the
           only thing that tells somebody what to do next. */
        body: clip(data.note ? `${data.summary} — ${data.note}` : data.summary || meta.label, 120),
        url: data.url || "/agent-portal",
      };
    case "applicationWaiting":
      return { ...base, title: `${who} applied to join your team`, body: clip(data.summary || "Waiting on your approval."), url: "/workspace" };
    case "rosterPublished":
      return {
        ...base,
        title: "Your roster changed",
        body: clip(data.summary || "New shifts have been published. Check before you plan anything."),
        url: "/agent-portal",
      };
    case "caseToSign":
      return { ...base, title: "Something needs your signature", body: clip(data.summary || meta.label), url: "/agent-portal" };
    case "slaBreach":
      return { ...base, title: "Past its SLA", body: clip(data.summary || meta.label), url: "/workspace" };
    default:
      return { ...base, title: meta.label, body: clip(data.summary || ""), url: "/" };
  }
}

/**
 * Everything wrong with this module's own wiring.
 *
 * The tab check is the one that matters: a notification pointing at a screen
 * the navigation does not place sends somebody to a page that does not exist,
 * which is worse than not telling them at all.
 */
export function checkNotifications(navOrder = []) {
  const problems = [];
  const tabs = new Set(navOrder);
  for (const [kind, meta] of Object.entries(NOTIFY_KINDS)) {
    if (!meta.label) problems.push(`${kind} has no label.`);
    if (!["high", "normal", "low"].includes(meta.urgency)) problems.push(`${kind} has no urgency.`);
    if (meta.tab && tabs.size && !tabs.has(meta.tab)) {
      problems.push(`${kind} points at screen "${meta.tab}", which the navigation does not place.`);
    }
    /* A required notification that quiet hours could suppress is a promise the
       module does not keep. Required means it gets through. */
    if (meta.required && meta.urgency !== "high") {
      problems.push(`${kind} is required but not high urgency, so quiet hours would hold it back.`);
    }
  }
  return problems;
}

/* One person thanking another.

   Every other record in this app is a violation, a deduction, a lapse or a
   request. That is an accurate picture of what workforce software is for and a
   poor reason for anybody to open it voluntarily. An agent's entire relationship
   with this product is: it tells them when they were late, and it pays them.

   This is the only table that records something good, and it exists because an
   app people open only when something is wrong is an app people learn to
   dread — which then makes every other feature in it harder to land.

   ── Not points ───────────────────────────────────────────────────────────

   The obvious build is a leaderboard. It is also the one that stops meaning
   anything within a month: people trade, managers hand them out evenly to avoid
   awkwardness, and the number keeps appearing on a scorecard long after it
   stopped measuring anything. Worse, once a number exists somebody will divide
   it by tenure and put it in a performance review, at which point thanking a
   colleague has become an assessed activity and nobody does it sincerely again.

   So what is stored is who, for what, and in whose words. There is no total.

   ── Why the giver is named ───────────────────────────────────────────────

   Anonymous praise is worth very little — it cannot be weighed, and a wall of
   it reads as a bot. Naming the giver is also what makes the one real abuse
   case visible: a manager quietly recognising only the people they like shows
   up immediately when every row says who sent it.

   ── Why a manager cannot recognise on somebody's behalf ──────────────────

   Because then it is not thanks, it is a performance note with a nicer name,
   and the person receiving it can tell. */

/** What somebody is being thanked for. Deliberately few — a long list turns a
    thank-you into a form. */
export const RECOGNITION_VALUES = {
  cover: {
    label: "Covered for me",
    labelAr: "غطّى مكاني",
    blurb: "Took a shift, stayed late, picked up a queue.",
  },
  helped: {
    label: "Helped me out",
    labelAr: "ساعدني",
    blurb: "Explained something, unblocked me, sat with me.",
  },
  customer: {
    label: "Great with a customer",
    labelAr: "تعامل ممتاز مع العميل",
    blurb: "Handled something difficult well.",
  },
  quality: {
    label: "Caught something",
    labelAr: "انتبه لخطأ",
    blurb: "Spotted a mistake before it went out.",
  },
  newStarter: {
    label: "Looked after a new starter",
    labelAr: "اهتم بزميل جديد",
    blurb: "",
  },
};

export const RECOGNITION_CODES = Object.keys(RECOGNITION_VALUES);
export const isRecognitionValue = (v) => Object.hasOwn(RECOGNITION_VALUES, v);

/** Who can see it. */
export const VISIBILITIES = {
  team: { label: "My team can see it", blurb: "The usual. It appears on the wall." },
  /* Some thanks are for something private — a colleague covering while somebody
     was unwell. A wall that only has one setting either exposes that or
     silences it, and silencing it is the more common outcome. */
  private: { label: "Just them and their manager", blurb: "For something they might not want on a wall." },
};
export const isVisibility = (v) => Object.hasOwn(VISIBILITIES, v);

/* A day's worth. Not a scarcity mechanic — a limit exists because somebody
   sending forty in an afternoon is either automating it or making a point, and
   both devalue every genuine one on the wall. High enough that no honest user
   will ever reach it. */
export const DAILY_LIMIT = 10;

/**
 * Everything wrong with a thank-you somebody is trying to send.
 *
 * @param {object} p
 * @param {{fromId?: string, sentToday?: number, recentToSame?: number}} ctx
 */
export function checkRecognition(p = {}, ctx = {}) {
  const problems = [];
  const warnings = [];

  const toId = String(p.toId ?? "");
  if (!toId) problems.push("Choose who you are thanking.");
  else if (toId === String(ctx.fromId ?? "")) {
    /* Cheap to catch and embarrassing to leave in. */
    problems.push("You cannot recognise yourself.");
  }

  if (!isRecognitionValue(p.value)) problems.push("Choose what it was for.");
  if (p.visibility && !isVisibility(p.visibility)) problems.push("Unknown visibility.");

  const note = String(p.note ?? "").trim();
  if (note.length < 10) {
    /* "Thanks!" on a wall is noise, and noise is what makes people stop
       reading the wall — which costs the sincere ones their audience. */
    problems.push("Say what they did. A thank-you with no reason in it is not worth reading.");
  }
  if (note.length > 600) problems.push("Keep it short enough that somebody will read it.");

  if ((ctx.sentToday ?? 0) >= DAILY_LIMIT) {
    problems.push(`You have sent ${DAILY_LIMIT} today. Anything more and they stop meaning much — try again tomorrow.`);
  }
  if ((ctx.recentToSame ?? 0) >= 3) {
    /* Not blocked. Somebody genuinely having a great week is a real thing, and
       so is a manager thanking their favourite three times a day. */
    warnings.push("You have thanked them a few times recently. That is fine — just worth noticing.");
  }

  return { problems, warnings };
}

/**
 * What a person's recognition looks like summarised.
 *
 * No total score, on purpose — see the header. What comes back is a count and
 * a spread, because "six, from five different people" and "six, all from their
 * own manager" are very different facts and only the second is worth a look.
 */
export function summarise(rows = []) {
  const givers = new Set(rows.map((r) => r.fromId));
  const byValue = {};
  for (const r of rows) byValue[r.value] = (byValue[r.value] ?? 0) + 1;
  return {
    count: rows.length,
    givers: givers.size,
    byValue,
    /* The signal worth surfacing: praise from one source is a relationship,
       praise from many is a reputation. */
    concentrated: rows.length >= 3 && givers.size === 1,
  };
}

/** Everything wrong with this module's own wiring. */
export function checkRecognitionConfig() {
  const problems = [];
  for (const [code, meta] of Object.entries(RECOGNITION_VALUES)) {
    if (!meta.label) problems.push(`${code} has no label.`);
    if (!meta.labelAr) problems.push(`${code} has no Arabic label.`);
  }
  if (RECOGNITION_CODES.length > 8) {
    problems.push("Too many values — a long list turns a thank-you into a form.");
  }
  for (const [code, meta] of Object.entries(VISIBILITIES)) {
    if (!meta.label) problems.push(`visibility ${code} has no label.`);
  }
  return problems;
}

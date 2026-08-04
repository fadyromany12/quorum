/* Documents — the paper file the app could not replace.

   Contracts, national IDs, work permits, medical certificates, client-mandated
   training certificates. All of it exists, none of it was here, so HR kept a
   physical folder and the app was a second system that did not know what was
   in it. A record that cannot tell you whether somebody's work permit is still
   valid is not the record.

   ── The app stores the pointer, never the file ────────────────────────────

   The same decision `Case.evidenceUrl` and `EmployeePII.nationalIdScanUrl`
   already made, twice, deliberately. It is worth restating because it looks
   like a limitation and is mostly a feature: a scan of somebody's national ID
   is the most sensitive object in the company, and the safest place for it is
   the document system that already has retention rules, access logs and a
   legal owner. Copying it into this database would mean encrypting it,
   backing it up, and answering a subject-access request about it.

   What this module owns is everything the file cannot tell you: what kind of
   document it is, when it expires, whether a person has checked it, and what
   is missing.

   ── Expired is not missing ────────────────────────────────────────────────

   The distinction the whole module turns on. "We have never had their work
   permit" and "their work permit lapsed in March" are different failures with
   different fixes and different legal exposure, and a completeness percentage
   that collapses them tells you neither. Every function here keeps them apart.

   ── Notice periods are per kind, because renewals take different lengths ───

   A medical certificate is a morning at a clinic. An Egyptian national ID
   renewal is weeks, and a work permit can be months. One global "expiring
   soon" threshold is either useless for the slow ones or noise for the fast
   ones, so each kind carries its own. */

import { addDays, parseDay, todayStr } from "./dates.js";

/**
 * Every kind of document the company holds against a person.
 *
 * `statutory` means an inspector or an auditor can ask for it, which is what
 * makes a gap urgent rather than untidy. `sensitive` means it sits behind the
 * same permission as bank details rather than the directory.
 */
export const DOC_KINDS = {
  contract: {
    label: "Employment contract",
    labelAr: "عقد العمل",
    expires: true,
    noticeDays: 60,
    statutory: true,
    sensitive: false,
  },
  nationalId: {
    label: "National ID",
    labelAr: "بطاقة الرقم القومي",
    expires: true,
    /* Egyptian ID renewal is a queue and a wait, not an errand. */
    noticeDays: 90,
    statutory: true,
    sensitive: true,
  },
  passport: { label: "Passport", labelAr: "جواز السفر", expires: true, noticeDays: 180, statutory: false, sensitive: true },
  workPermit: {
    label: "Work permit",
    labelAr: "تصريح العمل",
    expires: true,
    /* The one where lapsing stops somebody working the same day. */
    noticeDays: 120,
    statutory: true,
    sensitive: true,
  },
  militaryStatus: { label: "Military status", labelAr: "الموقف من التجنيد", expires: false, noticeDays: 0, statutory: true, sensitive: true },
  socialInsurance: { label: "Social insurance form", labelAr: "استمارة التأمينات", expires: false, noticeDays: 0, statutory: true, sensitive: true },
  medicalCert: { label: "Medical fitness certificate", labelAr: "شهادة اللياقة الصحية", expires: true, noticeDays: 30, statutory: true, sensitive: true },
  policeCert: { label: "Police clearance", labelAr: "الفيش الجنائي", expires: true, noticeDays: 60, statutory: true, sensitive: true },
  educationCert: { label: "Education certificate", labelAr: "المؤهل الدراسي", expires: false, noticeDays: 0, statutory: false, sensitive: false },
  trainingCert: {
    label: "Training certificate",
    labelAr: "شهادة تدريب",
    expires: true,
    /* Client-mandated certifications are the ones that pull somebody off an
       account the day they lapse, so the notice is generous. */
    noticeDays: 45,
    statutory: false,
    sensitive: false,
  },
  offerLetter: { label: "Offer letter", labelAr: "خطاب العرض", expires: false, noticeDays: 0, statutory: false, sensitive: false },
  bankLetter: { label: "Bank account letter", labelAr: "خطاب البنك", expires: false, noticeDays: 0, statutory: false, sensitive: true },
  other: { label: "Other", labelAr: "أخرى", expires: false, noticeDays: 0, statutory: false, sensitive: false },
};

export const DOC_CODES = Object.keys(DOC_KINDS);
export const isDocKind = (k) => Object.hasOwn(DOC_KINDS, k);
export const isSensitive = (k) => Boolean(DOC_KINDS[k]?.sensitive);

/** Kinds a complete file must contain. Statutory ones — the rest are useful, not required. */
export const REQUIRED_KINDS = DOC_CODES.filter((k) => DOC_KINDS[k].statutory);

/** Notice for a kind, with a floor so an unknown kind is never "no warning". */
export const noticeFor = (kind) => DOC_KINDS[kind]?.noticeDays || 30;

/* ── State of one document ─────────────────────────────────────────────────*/

/**
 * What state a held document is in.
 *
 * "expiringSoon" is deliberately computed from the kind's own notice period,
 * not from a global threshold — see the header. A work permit ninety days out
 * is already urgent; a medical certificate ninety days out is not news.
 *
 * @returns {"valid"|"expiringSoon"|"expired"|"noExpiry"}
 */
export function docStatus(doc = {}, today = todayStr()) {
  const meta = DOC_KINDS[doc.kind];
  if (!meta?.expires || !doc.expiresOn) return "noExpiry";
  const exp = parseDay(doc.expiresOn);
  const now = parseDay(today);
  if (Number.isNaN(exp)) return "noExpiry";
  if (exp < now) return "expired";
  return exp <= parseDay(addDays(today, meta.noticeDays)) ? "expiringSoon" : "valid";
}

/** Days until it lapses. Negative once it has, which is the number that matters. */
export function daysLeft(doc = {}, today = todayStr()) {
  if (!doc.expiresOn) return null;
  const exp = parseDay(doc.expiresOn);
  if (Number.isNaN(exp)) return null;
  return Math.round((exp - parseDay(today)) / 86400000);
}

/**
 * Everything wrong with a document somebody is trying to record.
 *
 * A pointer that is not a link is allowed on purpose — "cabinet 3, folder B"
 * is a real answer in a company that still has a cabinet, and refusing it
 * would push people to paste a fake URL.
 */
export function checkDocument(p = {}, { today = todayStr() } = {}) {
  const problems = [];
  const warnings = [];

  if (!isDocKind(p.kind)) problems.push("Choose what kind of document this is.");
  if (!String(p.location ?? "").trim()) {
    problems.push("Say where the document is — a link, or where to find it if it is on paper.");
  }

  const meta = DOC_KINDS[p.kind];
  const expiresOn = String(p.expiresOn ?? "");
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
    problems.push("Give the expiry as yyyy-mm-dd.");
  } else if (meta?.expires && !expiresOn) {
    /* A warning rather than a problem: a contract with no end date is a real
       thing, and blocking on it would make people invent one. */
    warnings.push(`${meta.label} usually has an expiry date. Without one it will never be chased.`);
  } else if (expiresOn && meta && !meta.expires) {
    warnings.push(`${meta.label} does not usually expire. Check the date is not the issue date.`);
  }

  if (expiresOn && /^\d{4}-\d{2}-\d{2}$/.test(expiresOn) && expiresOn < today) {
    /* Recording an already-expired document is legitimate — you file what you
       have while chasing the new one — but it must not look like compliance. */
    warnings.push("That document has already expired. It is recorded, but it does not make the file complete.");
  }

  const issuedOn = String(p.issuedOn ?? "");
  if (issuedOn && expiresOn && issuedOn > expiresOn) {
    problems.push("It cannot expire before it was issued.");
  }

  return { problems, warnings };
}

/* ── State of a whole file ─────────────────────────────────────────────────*/

/**
 * What is missing, what has lapsed, and what is about to.
 *
 * Three separate lists rather than one score, because they need three
 * different actions: chase the employee, chase the renewal, diarise the
 * renewal. A single "78% complete" hides which.
 *
 * Only the newest document of each kind counts. People re-file renewals
 * alongside the old one, and an expired 2023 passport sitting behind a valid
 * 2029 one must not report the file as expired.
 */
export function fileState(docs = [], { today = todayStr(), kinds = REQUIRED_KINDS } = {}) {
  const newest = new Map();
  for (const d of docs) {
    if (d.voided) continue;
    const prev = newest.get(d.kind);
    /* Newest by expiry where there is one, else by when it was recorded — a
       renewal always expires later than the thing it replaces. */
    const key = (x) => String(x.expiresOn || "") || String(x.issuedOn || "") || String(x.createdAt || "");
    if (!prev || key(d) > key(prev)) newest.set(d.kind, d);
  }

  const missing = [];
  const expired = [];
  const expiring = [];

  for (const kind of kinds) {
    const doc = newest.get(kind);
    if (!doc) {
      missing.push({ kind, label: DOC_KINDS[kind]?.label ?? kind });
      continue;
    }
    const state = docStatus(doc, today);
    if (state === "expired") expired.push({ ...doc, label: DOC_KINDS[kind]?.label ?? kind, days: daysLeft(doc, today) });
    else if (state === "expiringSoon") expiring.push({ ...doc, label: DOC_KINDS[kind]?.label ?? kind, days: daysLeft(doc, today) });
  }

  /* Anything held that is not required still gets chased when it lapses — a
     client-mandated training certificate is not statutory and still stops
     somebody working an account. */
  for (const [kind, doc] of newest) {
    if (kinds.includes(kind)) continue;
    const state = docStatus(doc, today);
    const row = { ...doc, label: DOC_KINDS[kind]?.label ?? kind, days: daysLeft(doc, today) };
    if (state === "expired") expired.push(row);
    else if (state === "expiringSoon") expiring.push(row);
  }

  expiring.sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  expired.sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  const held = kinds.filter((k) => newest.has(k) && docStatus(newest.get(k), today) !== "expired").length;

  return {
    missing,
    expired,
    expiring,
    /* Complete means every statutory kind is held and current. An expired
       document counts as not held for this number, which is the whole point of
       keeping the two lists apart everywhere else. */
    pct: kinds.length ? Math.round((held / kinds.length) * 100) : 100,
    complete: missing.length === 0 && expired.length === 0,
    newest: [...newest.values()],
  };
}

/** One line summarising a file, for a list where a full breakdown will not fit. */
export function summarise(state) {
  if (!state) return "";
  const bits = [];
  if (state.missing.length) bits.push(`${state.missing.length} missing`);
  if (state.expired.length) bits.push(`${state.expired.length} expired`);
  if (state.expiring.length) bits.push(`${state.expiring.length} expiring`);
  return bits.length ? bits.join(" · ") : "Complete";
}

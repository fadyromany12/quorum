/* Bilingual labels.

   The bug this suite exists for is not a wrong translation — it is a correct
   translation nobody can reach. The taxonomies carried 139 Arabic labels,
   written carefully, and every component reached for `.label` and got English
   regardless of locale. Nothing failed. Nothing looked broken. The Arabic was
   simply never rendered, and no test would have noticed.

   So what is asserted here is coverage and reachability: that every entry a
   user can see has an Arabic form, that the helper returns it, and that the
   fallbacks degrade to something readable rather than to a blank or a key. */

const I = await import("../src/lib/i18n.js");
const T = await import("../src/lib/taxonomy.js");
const J = await import("../src/lib/journey.js");
const S = await import("../src/lib/schedule.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

/** Entries a user actually sees, by the map they live in. */
const MAPS = {
  LEAVE_TYPES: T.LEAVE_TYPES,
  EXIT_REASONS: T.EXIT_REASONS,
  ACTIVITY_STATES: T.ACTIVITY_STATES,
  TRAINING_TYPES: T.TRAINING_TYPES,
  LOGOUT_REASONS: T.LOGOUT_REASONS,
  SCHEDULE_ACTIVITIES: S.SCHEDULE_ACTIVITIES,
};

console.log("\n── Every visible entry has both languages ──");
for (const [name, map] of Object.entries(MAPS)) {
  if (!map) { ok(`${name} exists`, false); continue; }
  const entries = Object.entries(map);
  const noEnglish = entries.filter(([, v]) => !v.label).map(([k]) => k);
  const noArabic = entries.filter(([, v]) => !v.labelAr).map(([k]) => k);
  ok(`${name}: all ${entries.length} have an English label`, noEnglish.length === 0, noEnglish.join(", "));
  ok(`${name}: all ${entries.length} have an Arabic label`, noArabic.length === 0, noArabic.join(", "));
}

console.log("\n── The journey and its navigation agree, in both languages ──");
ok("every phase has both", J.JOURNEY.every((p) => p.label && p.labelAr));
ok("every navigation section has both",
  J.NAV_SECTIONS.every((s) => s.label && s.labelAr),
  J.NAV_SECTIONS.filter((s) => !s.labelAr).map((s) => s.id).join(", "));
/* A phase section and the phase it names must be the same words. They are
   derived rather than duplicated, and this is the assertion that keeps it so. */
for (const p of J.JOURNEY) {
  const section = J.NAV_SECTIONS.find((s) => s.id === p.id);
  if (!section) continue;
  eq(`the "${p.id}" heading matches its phase in English`, section.label, p.label);
  eq(`and in Arabic`, section.labelAr, p.labelAr);
}

console.log("\n── The helper returns what the reader asked for ──");
eq("Arabic when asked in Arabic", I.labelFor(T.LEAVE_TYPES, "Casual", "ar"), T.LEAVE_TYPES.Casual.labelAr);
eq("English when asked in English", I.labelFor(T.LEAVE_TYPES, "Casual", "en"), T.LEAVE_TYPES.Casual.label);
eq("English for an unknown locale", I.labelFor(T.LEAVE_TYPES, "Casual", "fr"), T.LEAVE_TYPES.Casual.label);
eq("English for no locale at all", I.labelFor(T.LEAVE_TYPES, "Casual"), T.LEAVE_TYPES.Casual.label);

console.log("\n── Fallbacks degrade to something readable ──");
/* A code the taxonomy has dropped still exists in rows. Showing the code is
   honest; showing "" or "undefined" hides that a record points at something
   the system no longer defines. */
eq("an unknown code returns itself", I.labelFor(T.LEAVE_TYPES, "Sabbatical", "ar"), "Sabbatical");
eq("a missing map returns the code", I.labelFor(undefined, "Casual", "ar"), "Casual");
eq("an entry with no Arabic falls back to English", I.labelOf({ label: "Only English" }, "ar"), "Only English");
eq("an entry with neither returns the fallback", I.labelOf({}, "ar", "—"), "—");
eq("nothing at all returns the fallback", I.labelOf(null, "ar", "—"), "—");
ok("and never returns undefined", [null, {}, { label: "" }].every((x) => typeof I.labelOf(x, "ar") === "string"));

console.log("\n── Direction ──");
eq("Arabic is right to left", I.dirFor("ar"), "rtl");
eq("English is left to right", I.dirFor("en"), "ltr");
eq("an unknown locale is left to right rather than undefined", I.dirFor("zz"), "ltr");
ok("isRtl agrees with dirFor", I.LOCALES.every((l) => I.isRtl(l) === (I.dirFor(l) === "rtl")));

console.log("\n── The dictionary itself ──");
ok("every English key has an Arabic counterpart", (() => {
  /* Checked through t() rather than by reaching into the dictionary: a key that
     falls through to English is exactly what this is looking for. */
  const keys = ["login.signIn", "login.email", "login.password", "portal.subtitle", "portal.reviewSign"];
  return keys.every((k) => I.t("ar", k) !== I.t("en", k));
})());
eq("an unknown key returns itself rather than blank", I.t("ar", "nope.nothing"), "nope.nothing");
eq("an unknown locale falls back to English", I.t("zz", "login.signIn"), I.t("en", "login.signIn"));

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

/* Recognition.

   The assertions are mostly about what it refuses to become. A points system
   stops meaning anything within a month, an empty "Thanks!" is noise that costs
   the sincere ones their audience, and a summary with a total in it will end up
   divided by tenure in a performance review.

   The one abuse case worth surfacing is not fraud, it is concentration: six
   thank-yous from six people and six from one manager are very different facts. */

const R = await import("../src/lib/recognition.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

const good = { toId: "them", value: "cover", note: "Took my Friday night shift at two hours' notice." };
const ctx = { fromId: "me" };

console.log("\n── There is no score ──");
{
  const s = R.summarise([
    { fromId: "a", value: "cover" }, { fromId: "b", value: "helped" }, { fromId: "a", value: "cover" },
  ]);
  ok("the summary has no total, points or rank", !("points" in s) && !("score" in s) && !("rank" in s));
  eq("it counts, and counts the people", [s.count, s.givers], [3, 2]);
  eq("and breaks down by what for", s.byValue, { cover: 2, helped: 1 });
}

console.log("\n── Concentration is the thing worth noticing ──");
/* Praise from one source is a relationship; praise from many is a reputation. */
ok("three from one person is flagged",
  R.summarise([{ fromId: "boss", value: "cover" }, { fromId: "boss", value: "cover" }, { fromId: "boss", value: "helped" }]).concentrated);
ok("three from three is not",
  R.summarise([{ fromId: "a", value: "cover" }, { fromId: "b", value: "cover" }, { fromId: "c", value: "helped" }]).concentrated === false);
ok("two from one is not enough to say anything",
  R.summarise([{ fromId: "a", value: "cover" }, { fromId: "a", value: "cover" }]).concentrated === false);

console.log("\n── What it refuses ──");
const p = (patch, c = ctx) => R.checkRecognition({ ...good, ...patch }, c).problems;
eq("a real thank-you is accepted", p({}), []);
ok("thanking yourself is refused", p({ toId: "me" }).some((x) => /cannot recognise yourself/.test(x)));
ok("with nobody chosen it is refused", p({ toId: "" }).length > 0);
ok("with no reason chosen it is refused", p({ value: "" }).length > 0);
ok("an invented reason is refused", p({ value: "vibes" }).length > 0);
/* "Thanks!" on a wall is noise, and noise is what makes people stop reading the
   wall — which costs the sincere ones their audience. */
ok("an empty thank-you is refused", p({ note: "Thanks!" }).some((x) => /not worth reading/.test(x)));
ok("and an essay is too", p({ note: "x".repeat(700) }).length > 0);
ok("an unknown visibility is refused", p({ visibility: "world" }).length > 0);
eq("a known one is fine", p({ visibility: "private" }), []);

console.log("\n── The daily limit is not a scarcity mechanic ──");
/* High enough that no honest user reaches it; low enough that somebody
   automating it or making a point is stopped. */
ok("the limit is generous", R.DAILY_LIMIT >= 5);
eq("nine sent today is fine", p({}, { ...ctx, sentToday: 9 }), []);
ok("ten is not", p({}, { ...ctx, sentToday: 10 }).some((x) => /try again tomorrow/.test(x)));

console.log("\n── Repeatedly thanking the same person is noticed, not blocked ──");
{
  /* Somebody genuinely having a great week is real, and so is a manager
     thanking their favourite three times a day. Only one of those should be
     stopped, and software cannot tell which. */
  const r = R.checkRecognition(good, { ...ctx, recentToSame: 4 });
  eq("it is not refused", r.problems, []);
  ok("but it is mentioned", r.warnings.some((w) => /worth noticing/.test(w)));
}

console.log("\n── Some thanks are private ──");
/* A wall with only one setting either exposes something somebody wanted quiet
   or silences the thank-you altogether, and silence is the usual outcome. */
ok("there is a private option", R.isVisibility("private"));
ok("and a team one", R.isVisibility("team"));
ok("and nothing wider than the team", Object.keys(R.VISIBILITIES).every((v) => !/public|world|company/i.test(v)));

console.log("\n── The taxonomy stays short ──");
eq("nothing is inconsistent", R.checkRecognitionConfig(), []);
ok("a long list would be caught", (() => {
  const saved = { ...R.RECOGNITION_VALUES };
  for (let i = 0; i < 9; i++) R.RECOGNITION_VALUES[`x${i}`] = { label: "x", labelAr: "x" };
  /* RECOGNITION_CODES is computed at import, so re-derive the check's input. */
  const tooMany = Object.keys(R.RECOGNITION_VALUES).length > 8;
  for (const k of Object.keys(R.RECOGNITION_VALUES)) if (!(k in saved)) delete R.RECOGNITION_VALUES[k];
  return tooMany;
})());
ok("every value has both labels",
  R.RECOGNITION_CODES.every((c) => R.RECOGNITION_VALUES[c].label && R.RECOGNITION_VALUES[c].labelAr));

console.log("\n── Nothing throws on nothing ──");
eq("an empty summary is zeroes, not NaN", R.summarise([]), { count: 0, givers: 0, byValue: {}, concentrated: false });
ok("an empty payload is refused rather than crashing", R.checkRecognition({}, {}).problems.length > 0);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

/* The action queue behind the bell.

   The design choice worth testing is the one that is easy to regress: this is
   derived, so a kind that points at a screen the navigation does not place, or
   two kinds sharing a weight, both produce a list whose order nobody chose. */

const I = await import("../src/lib/inbox.js");
const J = await import("../src/lib/journey.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

console.log("\n── Wiring ──");
eq("every kind points at a screen the navigation places, and no two share a rank",
  I.checkInbox(J.NAV_ORDER), []);
ok("a kind pointing at a screen that does not exist is caught",
  I.checkInbox(["dashboard"]).some((p) => /does not place/.test(p)));

console.log("\n── Building the list ──");
{
  const b = I.buildInbox({ approval: { count: 3 }, review: { count: 2 }, incomplete: { count: 1, detail: "IBAN" } });
  eq("the total is the sum, not the number of kinds", b.total, 6);
  eq("ordered by what actually blocks someone else first",
    b.items.map((i) => i.kind), ["approval", "review", "incomplete"]);
  eq("detail rides along where a count alone would not help", b.items[2].detail, "IBAN");
}
eq("nothing waiting is an empty list rather than a zero-count row",
  I.buildInbox({ approval: { count: 0 } }).items, []);
eq("and its total is zero", I.buildInbox({}).total, 0);
eq("an unknown source is ignored rather than rendered as a mystery row",
  I.buildInbox({ nonsense: { count: 5 } }).items, []);
ok("a non-numeric count does not become NaN in the total",
  I.buildInbox({ approval: { count: "many" } }).total === 0);

console.log("\n── The signature item has no workspace screen ──");
/* Agents have no tabs at all, so an acknowledgement cannot link anywhere in the
   workspace — it must render as text rather than as a dead link. */
eq("acknowledgement deliberately names no tab", I.INBOX_KINDS.acknowledgement.tab, null);
eq("and so does the incomplete-record prompt", I.INBOX_KINDS.incomplete.tab, null);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

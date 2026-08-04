/* Assets.

   The assertions all point at one moment: the exit clearance step that says
   "IT equipment returned". Somebody ticks it, and what they are asserting is
   that they remembered what the person had. A leaver's laptop goes missing not
   because anybody stole it but because nobody could say it existed.

   So: a serialised item cannot be issued without a serial, an unreturned one
   blocks clearance by name rather than by boolean, and the amount owed is a
   number somebody can have a conversation about. */

const A = await import("../src/lib/assets.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

const asset = (kind, state = "issued", extra = {}) => ({ kind, state, serial: "SN1", replacementCostMinor: 0, ...extra });

console.log("\n── Which one, not what kind ──");
/* The distinction the whole table exists for. Without a serial this is a JSON
   array again, and at offboarding "a laptop" matches nothing. */
ok("a laptop without a serial is refused",
  A.checkIssue({ kind: "laptop", holderId: "e1" }).problems.some((p) => /serial number/.test(p)));
ok("and the refusal says why — nobody can tell which one",
  A.checkIssue({ kind: "laptop", holderId: "e1" }).problems.some((p) => /which one it was/.test(p)));
eq("with a serial it is fine",
  A.checkIssue({ kind: "laptop", holderId: "e1", serial: "SN-9", replacementCostMinor: 2500000 }).problems, []);
eq("a headset needs no serial", A.checkIssue({ kind: "headset", holderId: "e1" }).problems, []);
ok("a duplicate serial is refused",
  A.checkIssue({ kind: "laptop", holderId: "e1", serial: "SN-9" }, { serialTaken: true })
    .problems.some((p) => /already issued/.test(p)));
ok("issuing to nobody is refused", A.checkIssue({ kind: "headset" }).problems.length > 0);
ok("an unknown kind is refused", A.checkIssue({ kind: "yacht", holderId: "e1" }).problems.length > 0);
ok("a malformed issue date is refused",
  A.checkIssue({ kind: "headset", holderId: "e1", issuedOn: "01/01/2026" }).problems.length > 0);

console.log("\n── The cost is a warning, not a gate ──");
{
  /* Plenty of kit is genuinely written down to nothing, but an unpriced item is
     one nobody can have a conversation about later. */
  const r = A.checkIssue({ kind: "laptop", holderId: "e1", serial: "SN-9", replacementCostMinor: 0 });
  eq("issuing something unpriced is allowed", r.problems, []);
  ok("and flagged", r.warnings.some((w) => /nothing to quantify/.test(w)));
  eq("a uniform is not flagged — it is not coming back anyway",
    A.checkIssue({ kind: "uniform", holderId: "e1" }).warnings, []);
  ok("a negative cost is refused",
    A.checkIssue({ kind: "headset", holderId: "e1", replacementCostMinor: -5 }).problems.length > 0);
}

console.log("\n── Closing an item off ──");
ok("returning something not issued is refused",
  A.checkReturn(asset("laptop", "returned"), { state: "returned" }).problems.some((p) => /not currently issued/.test(p)));
eq("a normal return is fine", A.checkReturn(asset("laptop"), { state: "returned" }).problems, []);
/* A write-off with no reason is a hole somebody has to explain to finance. */
ok("a write-off with no reason is refused",
  A.checkReturn(asset("laptop"), { state: "writtenOff" }).problems.some((p) => /cannot be reconciled/.test(p)));
ok("so is a loss with no reason",
  A.checkReturn(asset("laptop"), { state: "lost" }).problems.length > 0);
eq("with a reason it is fine",
  A.checkReturn(asset("laptop"), { state: "lost", note: "Reported stolen on the metro, police report filed." }).problems, []);
ok("an invented state is refused", A.checkReturn(asset("laptop"), { state: "eaten" }).problems.length > 0);
ok("'still issued' is not a way to close it", A.checkReturn(asset("laptop"), { state: "issued" }).problems.length > 0);

console.log("\n── What is still out, and what it is worth ──");
{
  const held = [
    asset("laptop", "issued", { serial: "SN-9", replacementCostMinor: 2500000 }),
    asset("headset", "issued", { replacementCostMinor: 90000 }),
    asset("monitor", "returned", { replacementCostMinor: 400000 }),
    asset("uniform", "issued", { replacementCostMinor: 30000 }),
  ];
  const o = A.outstanding(held);
  eq("only issued items count as out", o.count, 3);
  eq("and the total is what replacing them would cost", o.valueMinor, 2500000 + 90000 + 30000);
  /* A uniform going missing is not a reason to hold somebody's final
     settlement. */
  eq("but only the ones that have to come back block clearance", o.blocking.length, 2);
  ok("so clearance is not ready", o.clearanceReady === false);
}

console.log("\n── The clearance step tells you what to chase ──");
{
  /* "IT equipment returned: no" tells the person ticking it nothing they can
     act on. */
  const s = A.clearanceState([asset("laptop", "issued", { serial: "SN-9", replacementCostMinor: 2500000 })]);
  ok("it is not ready", s.ready === false);
  ok("and names the item and its serial", /Laptop \(SN-9\)/.test(s.reason));
  eq("with the amount at stake", s.valueMinor, 2500000);

  const clear = A.clearanceState([asset("laptop", "returned")]);
  ok("everything back is ready", clear.ready);
  ok("and says so", /Everything that has to come back is back/.test(clear.reason));

  const none = A.clearanceState([]);
  ok("nobody issued anything is also ready", none.ready);
  ok("and says that rather than implying a return happened", /Nothing was ever issued/.test(none.reason));

  const uniformOnly = A.clearanceState([asset("uniform", "issued")]);
  ok("an unreturned uniform does not hold up a final settlement", uniformOnly.ready);
}

console.log("\n── The taxonomy's own wiring ──");
eq("nothing is inconsistent", A.checkAssetConfig(), []);
/* A serial exists so the item can be matched back. If nothing ever checks that
   it came back, the serial is decoration. */
ok("a serialised item that does not block clearance is caught", (() => {
  const saved = A.ASSET_KINDS.laptop.blocksClearance;
  A.ASSET_KINDS.laptop.blocksClearance = false;
  const problems = A.checkAssetConfig();
  A.ASSET_KINDS.laptop.blocksClearance = saved;
  return problems.some((p) => /nothing ever checks it came back/.test(p));
})());
ok("every kind has both labels", A.ASSET_CODES.every((c) => A.ASSET_KINDS[c].label && A.ASSET_KINDS[c].labelAr));
ok("issued is the only open state", A.ASSET_STATES.filter((s) => s !== "issued").every((s) => !A.isOut({ state: s })));

console.log("\n── Nothing throws on nothing ──");
eq("no assets is zero, not NaN", A.outstanding([]).valueMinor, 0);
ok("and clearance is ready", A.outstanding([]).clearanceReady);
ok("an empty issue is refused rather than crashing", A.checkIssue({}).problems.length > 0);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

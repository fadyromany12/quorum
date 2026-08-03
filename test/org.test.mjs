/* Accounts and their lines of business.

   The case that matters is the legacy one. `accounts` holds a live list in the
   shape `["Hertz", …]`, and the nesting has to arrive without a migration —
   read old, write new, nothing backfilled. Every other test here exists to stop
   a settings screen writing something the rest of the app cannot read. */

const O = await import("../src/lib/org.js");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

const CURRENT = [
  { name: "Hertz", lobs: ["EMEA", "North America"] },
  { name: "Lenovo", lobs: ["EMEA", "GTAP"] },
  { name: "Beko", lobs: [] },
];

console.log("\n── The legacy shape still reads ──");
eq("a flat list of names normalises",
  O.normaliseAccounts(["Hertz", "Lenovo"]),
  [{ name: "Hertz", lobs: [] }, { name: "Lenovo", lobs: [] }]);
eq("and yields its names", O.accountNames(["Hertz", "Lenovo"]), ["Hertz", "Lenovo"]);
eq("a legacy account simply has no lines yet", O.lobsFor(["Hertz"], "Hertz"), []);
eq("the two shapes can be mixed mid-migration",
  O.normaliseAccounts(["Hertz", { name: "Lenovo", lobs: ["EMEA"] }]),
  [{ name: "Hertz", lobs: [] }, { name: "Lenovo", lobs: ["EMEA"] }]);

console.log("\n── Normalising ──");
eq("the current shape passes through", O.normaliseAccounts(CURRENT), CURRENT);
eq("whitespace is trimmed",
  O.normaliseAccounts([{ name: "  Hertz  ", lobs: ["  EMEA  "] }]),
  [{ name: "Hertz", lobs: ["EMEA"] }]);
eq("empty names are dropped, not kept as blanks",
  O.normaliseAccounts(["", "  ", "Hertz"]), [{ name: "Hertz", lobs: [] }]);
eq("duplicate accounts collapse, case-insensitively",
  O.accountNames(["Hertz", "HERTZ", "hertz"]), ["Hertz"]);
eq("duplicate lines collapse too",
  O.lobsFor([{ name: "A", lobs: ["EMEA", "emea"] }], "A"), ["EMEA"]);
/* A settings screen that cannot render is a settings screen that cannot be used
   to fix the config that broke it. */
eq("junk yields an empty org rather than throwing", O.normaliseAccounts("nonsense"), []);
eq("null likewise", O.normaliseAccounts(null), []);
eq("undefined likewise", O.normaliseAccounts(undefined), []);
eq("a list of nulls yields nothing", O.normaliseAccounts([null, undefined]), []);

console.log("\n── Lines belong to their account ──");
eq("Hertz has its own lines", O.lobsFor(CURRENT, "Hertz"), ["EMEA", "North America"]);
eq("Lenovo has different ones", O.lobsFor(CURRENT, "Lenovo"), ["EMEA", "GTAP"]);
/* The bug the nesting exists to fix: a flat shared list offered Hertz a line
   that only exists on Lenovo. */
eq("a line on one account is not offered on another",
  O.lobsFor(CURRENT, "Hertz").includes("GTAP"), false);
eq("an account with none has none", O.lobsFor(CURRENT, "Beko"), []);
/* Offering everything for an unknown account is how a form writes a pairing
   that does not exist. */
eq("an unknown account offers nothing, not everything", O.lobsFor(CURRENT, "Nintendo"), []);
eq("the fleet-wide list deduplicates across accounts",
  O.allLobs(CURRENT), ["EMEA", "North America", "GTAP"]);
eq("an empty org has no lines", O.allLobs([]), []);

console.log("\n── Pairings ──");
eq("a real pairing is valid", O.isValidPairing(CURRENT, "Hertz", "EMEA"), true);
eq("a line from the wrong account is not", O.isValidPairing(CURRENT, "Hertz", "GTAP"), false);
/* Blank is valid: plenty of roles sit on an account without a line, and
   refusing that would make the field mandatory by accident. */
eq("no line at all is valid", O.isValidPairing(CURRENT, "Hertz", ""), true);
eq("an unknown account invalidates any line", O.isValidPairing(CURRENT, "Nintendo", "EMEA"), false);

console.log("\n── Validating before saving ──");
eq("a good structure passes", O.checkAccounts(CURRENT).ok, true);
eq("and comes back normalised", O.checkAccounts(["Hertz"]).accounts, [{ name: "Hertz", lobs: [] }]);
eq("an empty list is refused",
  O.checkAccounts([]), { ok: false, reason: "At least one account is required." });
eq("a non-list is refused", O.checkAccounts("Hertz").ok, false);
eq("a blank account name is refused",
  O.checkAccounts([{ name: "  ", lobs: [] }]).ok, false);
eq("a duplicate account is refused, and named",
  O.checkAccounts(["Hertz", "hertz"]),
  { ok: false, reason: '"Hertz" is listed twice.' });
eq("a blank line name is refused",
  O.checkAccounts([{ name: "Hertz", lobs: ["EMEA", " "] }]).ok, false);
eq("a duplicate line is refused, and says which account",
  O.checkAccounts([{ name: "Hertz", lobs: ["EMEA", "emea"] }]).reason,
  '"EMEA" is listed twice under "Hertz".');
/* "All" is what the account filter uses for "no filter". An account called All
   would be unselectable. */
eq("the filter sentinels are reserved", O.checkAccounts(["All"]).ok, false);
eq("case does not evade the reservation", O.checkAccounts(["all"]).ok, false);
eq("and the refusal explains why", /reserved/.test(O.checkAccounts(["All"]).reason), true);

console.log("\n── What removing something would break ──");
{
  const staff = [
    { fullNameEn: "A", account: "Hertz", lob: "EMEA" },
    { fullNameEn: "B", account: "Hertz", lob: "EMEA" },
    { fullNameEn: "C", account: "Hertz", lob: "North America" },
    { fullNameEn: "D", account: "Lenovo", lob: "GTAP" },
  ];
  eq("removing a line counts who is on it",
    O.impactOfRemoving(staff, "Hertz", "EMEA").count, 2);
  eq("and names them, so the warning is concrete",
    O.impactOfRemoving(staff, "Hertz", "EMEA").names, ["A", "B"]);
  eq("removing the whole account counts everyone on it",
    O.impactOfRemoving(staff, "Hertz").count, 3);
  eq("an unused line is safe to remove",
    O.impactOfRemoving(staff, "Beko", "EMEA"), { count: 0, names: [], safe: true });
  eq("an empty roster makes everything safe",
    O.impactOfRemoving([], "Hertz").safe, true);
  eq("null is tolerated", O.impactOfRemoving(null, "Hertz").count, 0);
  eq("the name list is capped so a warning stays readable",
    O.impactOfRemoving(
      Array.from({ length: 30 }, (_, i) => ({ fullNameEn: `P${i}`, account: "Hertz", lob: "EMEA" })),
      "Hertz", "EMEA",
    ).names.length, 5);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

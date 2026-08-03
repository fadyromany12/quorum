/* Every design token a component reads must actually exist.

   This test exists because of a bug that shipped past a typecheck, a build and
   a browser: three new components styled themselves with `P.signal`, and the
   token is called `P.petrol` — the name was kept when the palette was renamed
   because forty call sites read it. `P.signal` is therefore `undefined`, and
   `undefined` in a React style object is not an error. It is silently dropped.

   So the active tab in a toggle had no background, two accent icons fell back
   to currentColor, and everything still rendered, built and passed. Nothing in
   JavaScript's type system catches a missing property on a plain object read
   from JSX, and nothing in a screenshot catches a colour that was never
   supposed to be grey.

   The check is a scan rather than a type: tokens.js is plain JS on purpose, so
   the only way to know a name is real is to look at every place one is used and
   compare. That is exactly the kind of thing worth spending a test on. */

import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const T = await import("../src/lib/tokens.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};

/** Every .js/.jsx/.ts/.tsx file under src. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(path);
  }
  return out;
}

const files = walk("src");
const known = new Set(Object.keys(T.P));

console.log("\n── The palette itself ──");
ok("the token map is not empty", known.size > 10);
ok("no token is undefined", Object.entries(T.P).every(([, v]) => v !== undefined && v !== null && v !== ""),
  Object.entries(T.P).filter(([, v]) => !v).map(([k]) => k).join(", "));
ok("every token resolves to a colour or a CSS variable",
  Object.entries(T.P).every(([, v]) => typeof v === "string" && (v.startsWith("var(") || v.startsWith("#") || v.startsWith("rgb"))),
  Object.entries(T.P).filter(([, v]) => typeof v !== "string" || !(v.startsWith("var(") || v.startsWith("#") || v.startsWith("rgb"))).map(([k]) => k).join(", "));

console.log("\n── Every P.<name> in the codebase names a real token ──");
const bad = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  // Only the palette object, not `P.something` on an unrelated variable — the
  // convention in this codebase is that `P` is always the palette import.
  if (!/\bfrom\s+["'][^"']*tokens(\.js)?["']/.test(src)) continue;
  for (const m of src.matchAll(/\bP\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!known.has(m[1])) bad.push(`${file}: P.${m[1]}`);
  }
}
ok("no component reads a token that does not exist", bad.length === 0, bad.slice(0, 10).join("\n         "));

console.log("\n── The names the rename left behind ──");
/* Guards against the specific trap: someone reaching for the obvious name.
   If `signal` is ever added as a real token these assertions should be deleted
   rather than worked around — but until then, silently returning undefined is
   the failure mode worth naming. */
ok("`petrol` is the accent token, kept from the rename", known.has("petrol"));
ok("`signal` is deliberately not a token name — the CSS variable is", !known.has("signal"));
ok("the accent nonetheless points at the signal variable", T.P.petrol === "var(--signal)");

console.log("\n── alpha() ──");
ok("alpha wraps a CSS variable in colour-mix rather than mangling it",
  /color-mix/.test(T.alpha("var(--signal)", 0.5)));
ok("and survives a plain hex", typeof T.alpha("#ff0000", 0.5) === "string");
ok("a missing colour does not produce the string undefined",
  !/undefined/.test(String(T.alpha(T.P.petrol, 0.4))));

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

/* The factory-reset gate.

   The whole point of this module is what it refuses, so the assertions worth
   having are the ones where somebody is one click away from erasing the
   database: a Super Admin signed in on a preview URL, and a production
   deployment where the flag was never set.

   The default-open development case is tested too, because a guard that gets
   in developers' way is a guard that gets worked around in production. */

const { factoryResetGate, RESET_FLAG } = await import("../src/lib/destructive.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

console.log("\n── Deployments are shut by default ──");
eq("production without the flag refuses", factoryResetGate({ NODE_ENV: "production" }).allowed, false);
eq("a preview refuses too — it shares the production database",
  factoryResetGate({ NODE_ENV: "production", VERCEL_ENV: "preview" }).allowed, false);
ok("and the refusal says why, not just no",
  /previews share that database/.test(factoryResetGate({ VERCEL_ENV: "preview" }).reason));
ok("the refusal names the flag so it is actionable",
  factoryResetGate({ VERCEL_ENV: "preview" }).reason.includes(RESET_FLAG));
ok("an empty env is treated as a deployment, not as development",
  factoryResetGate({}).allowed === false);
ok("and so is an empty-string flag",
  factoryResetGate({ NODE_ENV: "production", [RESET_FLAG]: "" }).allowed === false);

console.log("\n── Arming it is deliberate ──");
for (const v of ["true", "1", "yes", "on", "TRUE", " True "]) {
  ok(`${JSON.stringify(v)} arms the reset`, factoryResetGate({ NODE_ENV: "production", [RESET_FLAG]: v }).allowed);
}
ok("armed on a preview as well — the operator asked for it there",
  factoryResetGate({ VERCEL_ENV: "preview", [RESET_FLAG]: "true" }).allowed);
ok("the reason names the environment it was armed on",
  /preview/.test(factoryResetGate({ VERCEL_ENV: "preview", [RESET_FLAG]: "true" }).reason));

console.log("\n── The values that must not read as yes ──");
/* A truthy-string bug here is the difference between a guard and a decoration:
   `if (process.env.ALLOW_FACTORY_RESET)` would let all of these through. */
for (const v of ["false", "0", "no", "off", "FALSE"]) {
  ok(`${JSON.stringify(v)} does not arm it`, factoryResetGate({ NODE_ENV: "production", [RESET_FLAG]: v }).allowed === false);
}
ok("an explicit false beats development",
  factoryResetGate({ NODE_ENV: "development", [RESET_FLAG]: "false" }).allowed === false);
ok("and says the flag is what refused, rather than the environment",
  factoryResetGate({ NODE_ENV: "development", [RESET_FLAG]: "false" }).reason.includes(RESET_FLAG));
ok("a value that is neither is not guessed at",
  factoryResetGate({ NODE_ENV: "production", [RESET_FLAG]: "maybe" }).allowed === false);

console.log("\n── Local development stays open ──");
ok("next dev can reset without ceremony", factoryResetGate({ NODE_ENV: "development" }).allowed);
eq("and says so plainly", factoryResetGate({ NODE_ENV: "development" }).reason, "Running locally in development.");
ok("VERCEL_ENV=development is a deployment name, and it wins over NODE_ENV",
  factoryResetGate({ NODE_ENV: "production", VERCEL_ENV: "development" }).allowed);

console.log("\n── The route actually calls it ──");
{
  const src = await (await import("node:fs/promises")).readFile(
    new URL("../src/app/api/admin/reset/route.ts", import.meta.url), "utf8");
  ok("the reset route imports the gate", /factoryResetGate/.test(src));
  ok("and refuses on it rather than only logging",
    /if\s*\(!gate\.allowed\)\s*throw/.test(src));
  /* Order matters: an anonymous caller must not be able to probe how the
     deployment is configured by reading the 403 text. */
  ok("the role check comes first, so the gate never answers a stranger",
    src.indexOf("requireRole") < src.indexOf("factoryResetGate("));
  ok("and the seed only runs after both",
    src.indexOf("gate.allowed") < src.indexOf("seedAll("));
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

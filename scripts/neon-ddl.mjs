/* Apply schema DDL to Neon, additively and idempotently.

   The sandbox cannot open a TCP connection to Neon on 5432, so the Prisma CLI
   cannot migrate directly; this runs the same DDL over Neon's HTTPS driver
   instead. It is deliberately not `prisma db push`, which is free to drop
   things it does not recognise.

   Two safety properties:

     · Nothing destructive runs. The statement list is filtered, and anything
       that would drop, truncate or delete aborts the whole run rather than
       being skipped quietly — a filtered-out DROP means the generated DDL and
       this script disagree about what is happening, and that is worth stopping
       for.

     · "Already exists" is a skip, not a failure, so the script converges: it
       can be run against a database that is fully, partly, or not at all
       migrated and reach the same place.

   Usage: NEON_URL=… node scripts/neon-ddl.mjs /tmp/migrate.sql [--apply]
   Without --apply it reports what it would do and touches nothing. */

import { readFileSync } from "fs";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { ProxyAgent, setGlobalDispatcher } from "undici";

if (process.env.HTTPS_PROXY) setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
neonConfig.poolQueryViaFetch = true;

const file = process.argv[2] ?? "/tmp/migrate.sql";
const apply = process.argv.includes("--apply");
if (!process.env.NEON_URL) {
  console.error("NEON_URL is required.");
  process.exit(1);
}

const statements = readFileSync(file, "utf8")
  .split(/;\s*\n/)
  .map((chunk) => chunk.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
  .filter(Boolean);

const DESTRUCTIVE = /^\s*(DROP|TRUNCATE|DELETE\s+FROM)\b|\bDROP\s+(COLUMN|TABLE|CONSTRAINT|INDEX)\b/i;
const destructive = statements.filter((s) => DESTRUCTIVE.test(s));
if (destructive.length) {
  console.error(`Refusing to run: ${destructive.length} destructive statement(s) in the DDL.`);
  for (const d of destructive.slice(0, 5)) console.error("  " + d.slice(0, 120));
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.NEON_URL });
const q = async (sql, p = []) => (await pool.query(sql, p)).rows;

const tablesNow = async () =>
  (await q(`select table_name from information_schema.tables where table_schema='public' order by 1`)).map((r) => r.table_name);

const before = await tablesNow();
const counts = {};
for (const t of ["Employee", "User", "Case", "AuditLog"]) {
  if (before.includes(t)) counts[t] = (await q(`select count(*)::int n from "${t}"`))[0].n;
}
console.log(`Before: ${before.length} tables — ${JSON.stringify(counts)}`);
console.log(`${statements.length} statements, 0 destructive.`);

if (!apply) {
  console.log("Dry run. Pass --apply to execute.");
  await pool.end();
  process.exit(0);
}

let ran = 0, skipped = 0;
for (const s of statements) {
  try {
    await pool.query(s);
    ran++;
  } catch (e) {
    if (/already exists/i.test(e.message)) { skipped++; continue; }
    console.error("FAILED:", s.slice(0, 120), "→", e.message);
    await pool.end();
    process.exit(1);
  }
}
console.log(`DDL: ${ran} ran, ${skipped} already existed.`);

/* Verify per column rather than per table. "Already exists" on a table that
   predates this run would hide a column the run was supposed to add, so the
   check that matters is that every column the schema expects is present. */
const after = await tablesNow();
const added = after.filter((t) => !before.includes(t));
console.log(`After: ${after.length} tables (+${added.length}: ${added.join(", ") || "none"})`);

const expected = {
  Forecast: ["id", "account", "lob", "date", "interval", "contacts", "ahtSeconds", "source", "actorName", "actorRole", "note", "createdAt", "updatedAt"],
  ShiftPattern: ["id", "name", "account", "lob", "startTime", "durationMinutes", "paidBreakMinutes", "unpaidBreakMinutes", "active", "createdAt", "updatedAt"],
  ScheduleEntry: ["id", "employeeId", "date", "activity", "startTime", "durationMinutes", "patternId", "published", "note", "actorName", "actorRole", "createdAt", "updatedAt"],
};
let missing = 0;
for (const [table, cols] of Object.entries(expected)) {
  const have = (await q(
    `select column_name from information_schema.columns where table_schema='public' and table_name=$1`,
    [table]
  )).map((r) => r.column_name);
  const gone = cols.filter((c) => !have.includes(c));
  if (gone.length) { missing += gone.length; console.error(`  ${table}: MISSING ${gone.join(", ")}`); }
  else console.log(`  ${table}: all ${cols.length} columns present`);
}

const countsAfter = {};
for (const t of Object.keys(counts)) countsAfter[t] = (await q(`select count(*)::int n from "${t}"`))[0].n;
const lost = Object.keys(counts).filter((t) => countsAfter[t] < counts[t]);
console.log(`Row counts unchanged: ${lost.length === 0} — ${JSON.stringify(countsAfter)}`);

await pool.end();
process.exit(missing === 0 && lost.length === 0 ? 0 : 1);

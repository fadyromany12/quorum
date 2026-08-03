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

/* ── The blind spot, closed ───────────────────────────────────────────────────

   A `--from-empty` diff expresses a new column as a line inside a CREATE TABLE.
   If the table already exists, that whole statement is skipped as "already
   exists" and the column is silently never added — the schema and the database
   drift with nothing reporting it. This bit me adding one nullable column to a
   table with a single row.

   So the expected columns are parsed out of the CREATE TABLE blocks and
   compared against what the database actually has. Anything missing is added
   with an explicit ALTER, and the same parse then serves as the verification
   pass — every table, not a hand-written list of the ones I happened to be
   thinking about.

   Only nullable or defaulted columns can be added this way. A NOT NULL column
   with no default cannot be added to a table that has rows, and what those rows
   should say is a decision for a person; those are refused rather than guessed
   at, and the run exits non-zero. */

function expectedColumns(sql) {
  const out = new Map();
  const re = /CREATE TABLE\s+"?(?:public"?\.)?"([^"]+)"\s*\(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(sql))) {
    const [, table, body] = m;
    const cols = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim().replace(/,$/, "");
      if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/i.test(line)) continue;
      const c = /^"([^"]+)"\s+(.+)$/.exec(line);
      if (c) cols.push({ name: c[1], definition: c[2] });
    }
    if (cols.length) out.set(table, cols);
  }
  return out;
}

const expected = expectedColumns(readFileSync(file, "utf8"));
const newTables = (await tablesNow()).filter((t) => !before.includes(t));

let addedColumns = 0;
const refused = [];
for (const [table, cols] of expected) {
  if (!before.includes(table)) continue; // just created above, nothing to reconcile
  const have = new Set(
    (await q(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [table]))
      .map((r) => r.column_name)
  );
  for (const col of cols) {
    if (have.has(col.name)) continue;
    if (/NOT NULL/i.test(col.definition) && !/DEFAULT/i.test(col.definition)) {
      refused.push(`${table}.${col.name} is NOT NULL with no default — existing rows need a value someone has to choose.`);
      continue;
    }
    await pool.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.definition}`);
    console.log(`  + ${table}.${col.name}`);
    addedColumns++;
  }
}
console.log(`After: ${(await tablesNow()).length} tables (+${newTables.length}: ${newTables.join(", ") || "none"}), ${addedColumns} column(s) added to existing tables.`);

/* Verification over the whole schema, not a list I maintain by hand. */
let missing = 0;
for (const [table, cols] of expected) {
  const have = new Set(
    (await q(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`, [table]))
      .map((r) => r.column_name)
  );
  const gone = cols.filter((c) => !have.has(c.name)).map((c) => c.name);
  if (gone.length) { missing += gone.length; console.error(`  ${table}: MISSING ${gone.join(", ")}`); }
}
console.log(missing === 0 ? `Every column in all ${expected.size} tables is present.` : `${missing} column(s) missing.`);

if (refused.length) {
  console.error("Refused to add:");
  for (const r of refused) console.error("  " + r);
}

const countsAfter = {};
for (const t of Object.keys(counts)) countsAfter[t] = (await q(`select count(*)::int n from "${t}"`))[0].n;
const lost = Object.keys(counts).filter((t) => countsAfter[t] < counts[t]);
console.log(`Row counts unchanged: ${lost.length === 0} — ${JSON.stringify(countsAfter)}`);

await pool.end();
process.exit(missing === 0 && lost.length === 0 && refused.length === 0 ? 0 : 1);

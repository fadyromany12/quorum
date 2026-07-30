import { readFileSync } from "fs";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { buildEmployeeSeed } from "../src/lib/employee-samples.js";
import { probationEnd } from "../src/lib/employee.js";

if (process.env.HTTPS_PROXY) setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
neonConfig.poolQueryViaFetch = true;
const pool = new Pool({ connectionString: process.env.NEON_URL });

// Each chunk begins with Prisma's "-- CreateTable" style comment line; strip
// the comment lines inside the chunk rather than dropping the chunk.
const stmts = readFileSync("/tmp/migrate.sql", "utf8")
  .split(/;\s*\n/)
  .map((c) => c.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
  .filter(Boolean);
let ran = 0, skipped = 0;
for (const s of stmts) {
  try { await pool.query(s); ran++; }
  catch (e) {
    if (/already exists/i.test(e.message)) { skipped++; continue; } // idempotent re-run
    console.error("FAILED:", s.slice(0, 80), "→", e.message); process.exit(1);
  }
}
console.log(`DDL: ${ran} ran, ${skipped} already existed`);

const q = async (sql, p=[]) => (await pool.query(sql, p)).rows;
const [{ n: empCount }] = await q(`select count(*)::int n from "Employee"`);
if (empCount === 0) {
  const fixture = buildEmployeeSeed();
  for (const { _managerEmail, _functionalEmail, ...e } of fixture) {
    await pool.query(
      `insert into "Employee" (id,"empId","fullNameEn","fullNameAr","preferredName","workEmail","personalEmail",
        phone,gender,"birthDate","addressAr","linkedInUrl","jobTitle",department,account,lob,grade,"workSite",
        stage,"hireDate","probationEnd","exitDate","exitType","exitReason",assets,"createdAt","updatedAt")
       values (md5(random()::text||clock_timestamp()::text), $1,$2,$3,'',$4,'','',$5,$6,'','',$7,$8,$9,$10,$11,$12,
        $13::"EmploymentStage",$14,$15,$16,$17::"ExitType",$18,$19::jsonb, now(), now())`,
      [e.empId, e.fullNameEn, e.fullNameAr, e.workEmail, e.gender, e.birthDate, e.jobTitle, e.department,
       e.account, e.lob, e.grade, e.workSite, e.stage, e.hireDate,
       e.hireDate ? probationEnd(e.hireDate) : "", e.exitDate, e.exitType, e.exitReason, JSON.stringify(e.assets)]);
  }
  for (const e of fixture) {
    if (e._managerEmail) await pool.query(
      `update "Employee" set "directManagerId"=(select id from "Employee" where "workEmail"=$1) where "workEmail"=$2`,
      [e._managerEmail, e.workEmail]);
    if (e._functionalEmail) await pool.query(
      `update "Employee" set "functionalManagerId"=(select id from "Employee" where "workEmail"=$1) where "workEmail"=$2`,
      [e._functionalEmail, e.workEmail]);
  }
  await pool.query(`update "Employee" e set "userId"=u.id from "User" u where u.email=e."workEmail" and e."userId" is null`);
  await pool.query(
    `insert into "EmployeeEvent" (id,"employeeId",at,"effectiveDate",type,title,detail,"fromVal","toVal","actorName","actorRole","caseId",meta)
     select md5(random()::text||id), id,
       case when "hireDate"<>'' then ("hireDate"||'T09:00:00Z')::timestamptz else now() end,
       "hireDate",
       case when stage='Applicant' then 'NOTE' else 'HIRED' end,
       case when stage='Applicant' then 'Application received' else 'Joined the company' end,
       trim(both ' · ' from coalesce("jobTitle",'')||' · '||coalesce(department,'')||' · '||coalesce(account,'')),
       '','','system','SuperAdmin',null,'{}'::jsonb
     from "Employee"`);
  console.log(`seeded ${fixture.length} employees`);
} else {
  console.log(`employees already present (${empCount}) — seed skipped`);
}
for (const t of ["User","Case","Employee","EmployeeEvent","Request","LeaveLedgerEntry","AttendanceEvent"]) {
  const [{ n }] = await q(`select count(*)::int n from "${t}"`);
  console.log(t.padEnd(18), n);
}
await pool.end();

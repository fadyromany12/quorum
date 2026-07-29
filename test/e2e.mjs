/* Full-stack acceptance drive over HTTP: staff login → forced password change →
   HR finalization sets the ack flag → agent digital signature → immutability +
   audit trail + RBAC walls.

   Prerequisites: `npm run db && npm run db:push && npm run db:seed`, then the
   server (`npm run build && npm start`, or `npm run dev`). MUTATES the seeded
   data (changes passwords, signs a case) — reseed afterwards to demo cleanly. */

import { execFileSync } from "node:child_process";

const BASE = "http://localhost:3000";
// psql from PGBIN when set, else the PATH (falling back to the default Windows
// install dir so the original setup keeps working unconfigured).
const PSQL = process.env.PGBIN
  ? `${process.env.PGBIN}/psql${process.platform === "win32" ? ".exe" : ""}`
  : process.platform === "win32"
    ? "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"
    : "psql";
const sql = (q) =>
  execFileSync(PSQL, ["-h", "localhost", "-p", "5544", "-U", "postgres", "-d", "absence_ops", "-tAc", q], {
    encoding: "utf8",
  }).trim();

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
};

/* ── Minimal cookie jar ─────────────────────────────────────────────────── */
class Jar {
  constructor() { this.cookies = new Map(); }
  absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const val = pair.slice(i + 1).trim();
      if (val === "" || /expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, val);
    }
  }
  header() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
}

async function req(jar, path, { method = "GET", body, form } = {}) {
  const headers = { cookie: jar.header() };
  let payload;
  if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload, redirect: "manual", signal: AbortSignal.timeout(30000) });
  jar.absorb(res);
  return res;
}

async function login(email, password) {
  const jar = new Jar();
  const csrfRes = await req(jar, "/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();
  await req(jar, "/api/auth/callback/credentials", { method: "POST", form: { csrfToken, email, password } });
  const session = await (await req(jar, "/api/auth/session")).json();
  return { jar, session };
}

/* ── 1. Staff: login + forced change + workspace ────────────────────────── */
console.log("\n── Staff auth flow ──");
{
  const bad = await login("fady.bekhet@konecta.com", "WrongPassword1");
  ok("wrong password yields no session", !bad.session?.user);
}
let fady = await login("fady.bekhet@konecta.com", "Welcome@123");
ok("SuperAdmin session established", fady.session?.user?.role === "SuperAdmin", JSON.stringify(fady.session));
ok("default password flags mustChange", fady.session?.user?.mustChange === true);
{
  const r = await req(fady.jar, "/workspace");
  ok("workspace redirects to change-password while mustChange", r.status >= 300 && (r.headers.get("location") || "").includes("/change-password"), `status ${r.status}`);
}
{
  const r = await req(fady.jar, "/api/users/change-password", { method: "POST", body: { password: "Petrol#2026" } });
  ok("change-password accepts a real password", r.status === 200);
  const weak = await req(fady.jar, "/api/users/change-password", { method: "POST", body: { password: "short" } });
  ok("change-password rejects short ones", weak.status === 400);
}
fady = await login("fady.bekhet@konecta.com", "Petrol#2026");
ok("re-login with new password works, mustChange cleared", fady.session?.user?.mustChange === false);
{
  const r = await req(fady.jar, "/workspace");
  ok("workspace renders for staff", r.status === 200);
  const html = await r.text();
  ok("workspace carries server data (triage gate present)", html.includes("Triage gate") || html.includes("TRIAGE"));
}

/* ── 2. HR finalization sets the acknowledgement flag ───────────────────── */
console.log("\n── HR finalization → ack flag ──");
const caseId = sql(`select id from "Case" where stage='active' and "hrNeeded" and "opsConfirmed" and not "hrConfirmed" limit 1`);
ok("found an HR-queue case", !!caseId, "(none in seed?)");
const caseRow = JSON.parse(sql(`select row_to_json(c) from "Case" c where id='${caseId}'`));
{
  const entry = { ...caseRow, hrConfirmed: true, hrRef: "HR-2026-7777", actionDate: caseRow.actionDate || caseRow.date };
  const r = await req(fady.jar, `/api/entries/${caseId}`, { method: "PATCH", body: { entry } });
  ok("HR execution PATCH accepted", r.status === 200, `status ${r.status}: ${await r.text().then((t) => t.slice(0, 120))}`);
  const flag = sql(`select "requiresAcknowledgement"::text || '|' || coalesce("agentAcknowledgedAt"::text,'null') from "Case" where id='${caseId}'`);
  ok("case now requires acknowledgement, unsigned", flag === "true|null", flag);
}

/* ── 3. Agent portal + digital signature ────────────────────────────────── */
console.log("\n── Agent acknowledgement flow ──");
let nour = await login("nour.said@demo.konecta", "Welcome@123");
ok("agent session established", nour.session?.user?.role === "Agent");
await req(nour.jar, "/api/users/change-password", { method: "POST", body: { password: "Agent#2026x" } });
nour = await login("nour.said@demo.konecta", "Agent#2026x");
{
  const r = await req(nour.jar, "/workspace");
  ok("agent bounced away from workspace", r.status >= 300 && (r.headers.get("location") || "").includes("/agent-portal"), `status ${r.status}`);
  const p = await req(nour.jar, "/agent-portal");
  ok("agent portal renders", p.status === 200);
  const html = await p.text();
  ok("portal shows pending acknowledgements", html.includes("Pending acknowledgements"));
  ok("portal shows emergency quota card", html.includes("Emergency leave quota"));
  ok("portal shows 90-day timeline", html.includes("90-day case timeline"));
}

const nourCase = sql(`select id from "Case" where upper("empId")='EG0412' and "requiresAcknowledgement" and "agentAcknowledgedAt" is null limit 1`);
ok("agent has a pending case to sign", !!nourCase);
{
  const noTick = await req(nour.jar, "/api/cases/acknowledge", { method: "POST", body: { caseId: nourCase, signature: "Nour Ahmed Said", accepted: false } });
  ok("unchecked statement rejected", noTick.status === 400);
  const oneWord = await req(nour.jar, "/api/cases/acknowledge", { method: "POST", body: { caseId: nourCase, signature: "Nour", accepted: true } });
  ok("single-word signature rejected", oneWord.status === 400);

  const r = await req(nour.jar, "/api/cases/acknowledge", { method: "POST", body: { caseId: nourCase, signature: "Nour Ahmed Said", accepted: true } });
  ok("signature accepted", r.status === 200, `status ${r.status}`);

  const stamped = sql(`select ("agentAcknowledgedAt" is not null)::text || '|' || "agentSignature" from "Case" where id='${nourCase}'`);
  ok("case stamped with time + signature", stamped === "true|Nour Ahmed Said", stamped);

  const audit = sql(`select count(*) from "AuditLog" where action='CASE_ACKNOWLEDGED' and "caseId"='${nourCase}'`);
  ok("immutable audit row written", audit === "1", `count=${audit}`);
  const meta = sql(`select meta->>'signature' from "AuditLog" where action='CASE_ACKNOWLEDGED' and "caseId"='${nourCase}'`);
  ok("audit meta carries the signature", meta === "Nour Ahmed Said", meta);

  const again = await req(nour.jar, "/api/cases/acknowledge", { method: "POST", body: { caseId: nourCase, signature: "Nour Ahmed Said", accepted: true } });
  ok("re-signing is refused (write-once)", again.status === 409, `status ${again.status}`);
}

/* ── 4. Ownership + RBAC walls ──────────────────────────────────────────── */
console.log("\n── Ownership + RBAC ──");
{
  const other = sql(`select id from "Case" where upper("empId") not in ('EG0412') and "requiresAcknowledgement" and "agentAcknowledgedAt" is null limit 1`);
  if (other) {
    const r = await req(nour.jar, "/api/cases/acknowledge", { method: "POST", body: { caseId: other, signature: "Nour Ahmed Said", accepted: true } });
    ok("cannot sign another agent's case", r.status === 403, `status ${r.status}`);
  }
  const decide = await req(nour.jar, "/api/entries/decide", { method: "POST", body: { ids: ["x"], stage: "active", assignee: "a", comment: "123456789012345" } });
  ok("agent blocked from triage API", decide.status === 403);
  const staffAck = await req(fady.jar, "/api/cases/acknowledge", { method: "POST", body: { caseId: nourCase, signature: "Fady Bekhet X", accepted: true } });
  ok("staff blocked from signing (Agent-only)", staffAck.status === 403);
  const anon = new Jar();
  const noAuth = await req(anon, "/api/entries", { method: "POST", body: { entry: { id: "x" } } });
  ok("anonymous blocked from API", noAuth.status === 401);
  const loginPage = await req(anon, "/agent-portal");
  ok("anonymous bounced from portal", loginPage.status >= 300 && (loginPage.headers.get("location") || "").includes("/login"));
}

/* ── 5. Verdict authority still server-side ─────────────────────────────── */
console.log("\n── Server-side decide (spot check) ──");
{
  const reviewId = sql(`select id from "Case" where stage='review' limit 1`);
  if (reviewId) {
    const r = await req(fady.jar, "/api/entries/decide", {
      method: "POST",
      body: { ids: [reviewId], stage: "active", assignee: "Salma Elhadad", comment: "Verified against RTA raw data." },
    });
    ok("escalation via API works", r.status === 200, `status ${r.status}`);
    const stage = sql(`select stage from "Case" where id='${reviewId}'`);
    ok("case escalated in DB", stage === "active", stage);
    const audit = sql(`select count(*) from "AuditLog" where action='CASE_DECIDED' and "caseId"='${reviewId}'`);
    ok("decision audited", audit === "1");
  } else {
    console.log("  (no review-stage case left — skipped)");
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

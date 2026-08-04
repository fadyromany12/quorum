/* Exercising the rules engine against the spec's stated behaviours. */
import { readFileSync } from "node:fs";

const LIB = "../src/lib";
const { verdictFor, occurrenceFor, emergencyUsage, computeEscalations, countsForDiscipline, statusOf, slaFor } = await import(`${LIB}/engine.js`);
const { applyLaborLawCap, settleDeductions, deductionDaysOf } = await import(`${LIB}/deductions.js`);
const { DEFAULT_DCM } = await import(`${LIB}/dcm.js`);
const { addDays, todayStr, daysBetween, consecutiveRun } = await import(`${LIB}/dates.js`);

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`); }
};

/* A fixed anchor, not today.

   These tests used `todayStr()`, which made four of them fail on the 1st and
   2nd of any month and pass for the rest of it. The per-month deduction cap
   counts within a calendar month, so `D(2)` and `D(1)` land either side of a
   month boundary whenever the run happens early in a month — the engine was
   right to stop counting July's deduction against August, and the test was
   wrong to assume both dates shared a month.

   A suite whose result depends on the day it runs is not testing the rule. The
   anchor is mid-month so day arithmetic in either direction stays inside it,
   and every case that genuinely cares about a boundary now has to say so. */
const T = "2026-06-15";
const D = (n) => addDays(T, -n);
let seq = 0;
const mk = (o) => ({
  id: `e${++seq}`, account: "Lenovo", email: "a@x", empId: "EG1", tl: "TL",
  stage: "active", disciplinary: true, missingMin: 0, createdAt: seq,
  deductionDays: 0, deductionApplied: 0, activity: [], ...o,
});

console.log("\n── Date arithmetic ──");
eq("90 days apart", daysBetween("2026-01-01", "2026-04-01"), 90);
eq("addDays crosses month", addDays("2026-01-31", 1), "2026-02-01");
eq("leap day", addDays("2028-02-28", 1), "2028-02-29");
eq("consecutive run of 3", consecutiveRun(["2026-05-01", "2026-05-02", "2026-05-03"], "2026-05-02"), 3);
eq("broken run", consecutiveRun(["2026-05-01", "2026-05-03"], "2026-05-03"), 1);

console.log("\n── 90-day chain (spec 3A) ──");
{
  // day 0, day 80, day 170: neither gap exceeds 90, so the chain never breaks.
  const es = [mk({ date: D(170), violation: "Late login / tardy" }), mk({ date: D(90), violation: "Late login / tardy" })];
  eq("chained: 170d + 90d ago -> 3rd", occurrenceFor(es, "a@x", "Late login / tardy", D(0)).occ, 3);
}
{
  // A gap of 91 days resets the count.
  const es = [mk({ date: D(200), violation: "Late login / tardy" }), mk({ date: D(100), violation: "Late login / tardy" })];
  eq("gap 100d resets -> 1st", occurrenceFor(es, "a@x", "Late login / tardy", D(0)).occ, 1);
}
{
  const es = [mk({ date: D(91), violation: "NCNS" })];
  eq("exactly 91d -> reset", occurrenceFor(es, "a@x", "NCNS", D(0)).occ, 1);
  const es2 = [mk({ date: D(90), violation: "NCNS" })];
  eq("exactly 90d -> advances", occurrenceFor(es2, "a@x", "NCNS", D(0)).occ, 2);
}
{
  const es = [mk({ date: D(10), violation: "NCNS", stage: "dismissed" })];
  eq("dismissed excluded", occurrenceFor(es, "a@x", "NCNS", D(0)).occ, 1);
  const es2 = [mk({ date: D(10), violation: "NCNS", stage: "review" })];
  eq("pending triage not counted", occurrenceFor(es2, "a@x", "NCNS", D(0)).occ, 1);
}
{
  const es = [mk({ date: D(10), violation: "NCNS", email: "other@x" })];
  eq("other agent excluded", occurrenceFor(es, "a@x", "NCNS", D(0)).occ, 1);
}

console.log("\n── DCM progression ──");
{
  const es = [];
  const v1 = verdictFor("NCNS", "a@x", D(20), es, DEFAULT_DCM);
  eq("NCNS 1st", [v1.occ, v1.action], [1, "Written Warning + 3-day deduction"]);
  es.push(mk({ date: D(20), violation: "NCNS", action: v1.action, deductionDays: 3, deductionApplied: 3 }));
  const v2 = verdictFor("NCNS", "a@x", D(10), es, DEFAULT_DCM);
  eq("NCNS 2nd", [v2.occ, v2.action], [2, "Final Warning + 5-day deduction"]);
  es.push(mk({ date: D(10), violation: "NCNS", action: v2.action, deductionDays: 5, deductionApplied: 5 }));
  const v3 = verdictFor("NCNS", "a@x", D(1), es, DEFAULT_DCM);
  eq("NCNS 3rd -> termination", [v3.occ, v3.action], [3, "Termination of Employment"]);
}
{
  const v = verdictFor("Disclosing customer data", "a@x", D(0), [], DEFAULT_DCM);
  eq("ZT 1st", [v.severity, v.action, v.investigation], ["Zero Tolerance", "Zero Tolerance — Immediate Termination", true]);
}
{
  const v = verdictFor("Late login / tardy", "a@x", D(0), [], DEFAULT_DCM);
  eq("Minor 1st -> verbal, TL executes", [v.action, v.executor, v.cap.prescribed], ["Verbal Warning", "TL", 0]);
}
{
  // 4th occurrence has no a4 — must clamp to the 3rd step, not crash.
  const es = [1, 2, 3].map((i) => mk({ date: D(30 - i * 5), violation: "Late login / tardy" }));
  const v = verdictFor("Late login / tardy", "a@x", D(0), es, DEFAULT_DCM);
  eq("4th clamps to 3rd step", [v.occ, v.action], [4, "Written Warning + 3-day deduction"]);
}
{
  // Serious rule with only two steps defined.
  const es = [mk({ date: D(10), violation: "Physical assault / threats" })];
  const v = verdictFor("Physical assault / threats", "a@x", D(0), es, DEFAULT_DCM);
  eq("Serious 2nd -> termination", [v.occ, v.action], [2, "Termination of Employment"]);
}

console.log("\n── Labour-law caps (spec 3B) ──");
eq("parse deduction days", [deductionDaysOf("Written Warning + 3-day deduction"), deductionDaysOf("Verbal Warning")], [3, 0]);
{
  const c = applyLaborLawCap(7, { entries: [], email: "a@x", date: D(0) });
  eq("7 days -> capped at 5", [c.applied, c.incidentCapped, c.waived], [5, true, 2]);
}
{
  const es = [mk({ date: D(2), violation: "NCNS", deductionApplied: 3 })];
  const c = applyLaborLawCap(5, { entries: es, email: "a@x", date: D(1) });
  eq("3 used -> only 2 headroom", [c.applied, c.monthUsed, c.headroom, c.monthCapped], [2, 3, 2, true]);
}
{
  const es = [mk({ date: D(2), violation: "NCNS", deductionApplied: 5 })];
  const c = applyLaborLawCap(5, { entries: es, email: "a@x", date: D(1) });
  eq("month exhausted -> 0", [c.applied, c.headroom], [0, 0]);
}
{
  const es = [mk({ date: D(2), violation: "NCNS", deductionApplied: 5, stage: "dismissed" })];
  const c = applyLaborLawCap(5, { entries: es, email: "a@x", date: D(1) });
  eq("dismissed frees headroom", c.applied, 5);
}
{
  // Different calendar month -> fresh headroom.
  const es = [mk({ date: "2026-05-30", violation: "NCNS", deductionApplied: 5 })];
  const c = applyLaborLawCap(5, { entries: es, email: "a@x", date: "2026-06-01" });
  eq("new month resets headroom", c.applied, 5);
}
{
  const settled = settleDeductions([
    mk({ date: "2026-06-10", violation: "NCNS", action: "Written Warning + 3-day deduction", deductionDays: 3 }),
    mk({ date: "2026-06-20", violation: "NCNS", action: "Final Warning + 5-day deduction", deductionDays: 5 }),
  ]);
  eq("settle: 3 then 5 -> 3 + 2", settled.map((e) => e.deductionApplied), [3, 2]);
  const total = settled.reduce((s, e) => s + e.deductionApplied, 0);
  eq("settle: month total never exceeds 5", total, 5);
}

console.log("\n── Soft delete (void) ──");
{
  eq("voided case doesn't count for discipline", countsForDiscipline(mk({ voided: true })), false);
  eq("statusOf reports Voided", statusOf(mk({ voided: true })), "Voided");
  // A voided prior must not advance the occurrence chain.
  const es = [mk({ date: D(10), violation: "NCNS", voided: true })];
  eq("voided prior excluded from occurrence", occurrenceFor(es, "a@x", "NCNS", D(0)).occ, 1);
  // Voided emergency leave does not consume the annual quota.
  const em = [mk({ date: D(5), violation: "Emergency Leave", disciplinary: false, voided: true })];
  eq("voided emergency not counted", emergencyUsage(em, "a@x", D(0)).yearUsed, 0);
  // A voided case frees the month's deduction headroom for the next one.
  const settled = settleDeductions([
    mk({ date: "2026-06-10", violation: "NCNS", deductionApplied: 5, voided: true }),
    mk({ date: "2026-06-20", violation: "NCNS", action: "Final Warning + 5-day deduction", deductionDays: 5 }),
  ]);
  eq("voided frees month headroom", settled.find((e) => !e.voided).deductionApplied, 5);
  // Voided cases raise no systemic escalation flag.
  const flags = computeEscalations([mk({ date: D(5), violation: "NCNS", voided: true }), mk({ date: D(20), violation: "NCNS", voided: true })], T);
  eq("voided raises no escalation flag", flags.length, 0);
}

console.log("\n── Pipeline SLA ──");
{
  const now = Date.now();
  const DAY = 86400000;
  const fresh = mk({ stage: "review", createdAt: now });
  eq("fresh triage case within SLA", [slaFor(fresh).label, slaFor(fresh).breached], ["in triage", false]);
  eq("5-day-old triage case breaches SLA", slaFor(mk({ stage: "review", createdAt: now - 5 * DAY })).breached, true);
  eq("closed case has no SLA clock", slaFor(mk({ stage: "active", notified: true, opsConfirmed: true, hrNeeded: false })), null);
  eq("voided case has no SLA clock", slaFor(mk({ stage: "review", voided: true })), null);
  const hrWait = mk({ stage: "active", notified: true, opsConfirmed: true, hrNeeded: true, hrConfirmed: false, createdAt: now, activity: [{ at: now - 10 * DAY, by: "x", type: "ops", text: "" }] });
  eq("awaiting HR measured from OPS sign-off", [slaFor(hrWait).label, slaFor(hrWait).breached], ["awaiting HR", true]);
}

console.log("\n── Emergency leave (spec 3C) ──");
{
  const es = Array.from({ length: 6 }, (_, i) => mk({ date: D(150 - i * 20), violation: "Emergency Leave", disciplinary: false }));
  const u = emergencyUsage(es, "a@x", D(0));
  eq("6 used -> 7th exceeds", [u.yearUsed, u.yearExceeded], [6, true]);
  const v = verdictFor("Emergency Leave", "a@x", D(0), es, DEFAULT_DCM);
  eq("7th reclassified as absence", [v.disciplinary, v.reclassifiedFrom, v.action], [true, "Emergency Leave", "Written Warning + 1-day deduction"]);
}
{
  const es = [mk({ date: D(2), violation: "Emergency Leave", disciplinary: false }), mk({ date: D(1), violation: "Emergency Leave", disciplinary: false })];
  const v = verdictFor("Emergency Leave", "a@x", D(0), es, DEFAULT_DCM);
  eq("3 consecutive -> reclassified", [v.disciplinary, v.reclassifiedFrom], [true, "Emergency Leave"]);
}
{
  const es = [mk({ date: D(1), violation: "Emergency Leave", disciplinary: false })];
  const v = verdictFor("Emergency Leave", "a@x", D(0), es, DEFAULT_DCM);
  eq("2 consecutive -> still leave", v.disciplinary, false);
}

console.log("\n── Escalation flags ──");
{
  const es = [
    mk({ date: D(5), violation: "Late login / tardy" }),
    mk({ date: D(10), violation: "Exceeding break time" }),
    mk({ date: D(20), violation: "NCNS" }),
  ];
  const f = computeEscalations(es, T);
  eq("3-in-30 fires", f.some((x) => x.kind === "3in30"), true);
}
{
  const es = [mk({ date: D(5), violation: "NCNS" }), mk({ date: D(20), violation: "NCNS" })];
  const f = computeEscalations(es, T);
  eq("repeat NCNS fires", f.some((x) => x.kind === "ncns"), true);
}
{
  const es = [mk({ date: D(5), violation: "Late login / tardy", stage: "dismissed" })];
  eq("dismissed raises no flag", computeEscalations(es, T).length, 0);
}

/* ── v4 additions: identity, compensation, RTA, auth ─────────────────────── */

const { agentMatches, agentKeyOf } = await import(`${LIB}/identity.js`);
const { applyCompensation } = await import(`${LIB}/compensation.js`);
const { parseCsv, parseDur, parseRtaDate, mapHeaders, assessRta, buildEntries, TEMPLATE_CSV } = await import(`${LIB}/rta.js`);
const { can, TABS_FOR, ROLES, ROLE_LABEL, DEFAULT_PASSWORD, passwordProblem } = await import(`${LIB}/auth.js`);
const { FLEET_WIDE_ROLES } = await import(`${LIB}/employee.js`);
const bcrypt = (await import("bcryptjs")).default;

console.log("\n── Agent identity (empId OR email) ──");
eq("email matches email", agentMatches({ email: "A@x", empId: "" }, { email: "a@x" }), true);
eq("empId matches empId", agentMatches({ email: "", empId: "eg0412" }, { empId: "EG0412" }), true);
eq("string ref still works", agentMatches({ email: "a@x" }, "a@x"), true);
eq("no shared identifier -> no match", agentMatches({ email: "a@x", empId: "" }, { empId: "EG1" }), false);
eq("both empty -> no match", agentMatches({ email: "", empId: "" }, { email: "", empId: "" }), false);
eq("key prefers empId", agentKeyOf({ email: "a@x", empId: "EG1" }), "eg1");
{
  // The point of the rework: an email-keyed manual case and an ID-keyed RTA
  // case for the same person must chain into one occurrence count.
  const es = [mk({ date: D(10), violation: "NCNS", email: "a@x", empId: "EG0412" })];
  eq("RTA row (empId only) chains with manual history", occurrenceFor(es, { email: "", empId: "EG0412" }, "NCNS", D(0)).occ, 2);
}

console.log("\n── Compensable hours (spec 4D) ──");
{
  const c = applyCompensation({ tardyMin: 25, compMin: 25 });
  eq("fully compensated", [c.net, c.fullyCompensated], [0, true]);
}
{
  const c = applyCompensation({ tardyMin: 30, missingMin: 60, compMin: 45 });
  eq("partial: 90 lost, 45 comp -> 45 net", [c.lost, c.net, c.partiallyCompensated], [90, 45, true]);
}
{
  const c = applyCompensation({ missingMin: 30, compMin: 90 });
  eq("comp never exceeds lost", [c.comp, c.net], [30, 0]);
}
eq("nothing lost -> not 'fully compensated'", applyCompensation({ compMin: 60 }).fullyCompensated, false);

console.log("\n── RTA parsing ──");
eq("parseDur H:MM", [parseDur("0:25"), parseDur("9:00")], [25, 540]);
eq("parseDur decimal hours", [parseDur("1.5"), parseDur("0"), parseDur("")], [90, 0, 0]);
eq("parseRtaDate ISO", parseRtaDate("2026-07-14"), "2026-07-14");
eq("parseRtaDate DD/MM/YYYY", parseRtaDate("14/07/2026"), "2026-07-14");
eq("parseRtaDate MM/DD disambiguated", parseRtaDate("07/14/2026"), "2026-07-14");
eq("parseRtaDate garbage", parseRtaDate("yesterday"), "");
eq("quoted comma survives", parseCsv('a,"b,c",d')[0], ["a", "b,c", "d"]);
eq("escaped quote survives", parseCsv('a,"say ""hi""",c')[0], ["a", 'say "hi"', "c"]);
{
  const map = mapHeaders(["LOB", "Date", "Employee Name", "Employee ID", "Shift Start", "Shift End", "Status", "Executor Name", "Tardy", "Missing Hours", "Early Departure", "Hours can be compenstaed", "Status / Violation"]);
  eq("all 13 RTA headers map", Object.keys(map).length, 13);
  eq("typo'd compensated column maps", map.comp, 11);
  eq("Status vs Status/Violation kept apart", [map.status, map.violation], [6, 12]);
}
{
  const a = assessRta(TEMPLATE_CSV, DEFAULT_DCM);
  eq("template classifies", [a.counts.irregular, a.counts.compensated, a.counts.clean, a.counts.error || 0], [2, 1, 1, 0]);
  const built = buildEntries(a.rows, { account: "Beko", entries: [], dcm: DEFAULT_DCM, uploadedBy: "WFM" });
  eq("template commits 2 to triage + 1 auto-ack", [built.toTriage, built.acked], [2, 1]);
  const ack = built.entries.find((e) => e.stage === "active");
  eq("auto-ack is closed and non-disciplinary", [ack.disciplinary, ack.deductionApplied, ack.opsConfirmed], [false, 0, true]);
}
{
  // Two NCNS for one agent in one file: at upload both verdicts are provisional
  // №1 (pending cases never count), and the chain forms when the PM escalates —
  // decideCases re-verdicts oldest-first, so the second becomes a 2nd occurrence.
  const { decideCases } = await import(`${LIB}/engine.js`);
  const csv = [
    "Date,Employee Name,Employee ID,Status,Tardy,Missing Hours,Early Departure,Hours can be compenstaed",
    `${D(3)},Tarek H,EG0644,NCNS,0,9:00,0,0`,
    `${D(1)},Tarek H,EG0644,NCNS,0,9:00,0,0`,
  ].join("\n");
  const a = assessRta(csv, DEFAULT_DCM);
  const built = buildEntries(a.rows, { account: "Beko", entries: [], dcm: DEFAULT_DCM, uploadedBy: "WFM" });
  eq("upload-time verdicts are provisional №1s", built.entries.map((e) => e.occurrence), [1, 1]);

  const decided = decideCases(built.entries, built.entries.map((e) => e.id), "active", { by: "PM", assignee: "TL", comment: "Verified against RTA." }, DEFAULT_DCM);
  const byDate = [...decided].sort((x, y) => x.date.localeCompare(y.date));
  eq("bulk escalation chains 1st -> 2nd", byDate.map((e) => e.occurrence), [1, 2]);
  eq("escalated actions follow the NCNS progression", byDate.map((e) => e.action), ["Written Warning + 3-day deduction", "Final Warning + 5-day deduction"]);
  eq("second NCNS capped by month headroom (3, then 5 -> 2)", byDate.map((e) => e.deductionApplied), [3, 2]);
  eq("both carry the escalation log entry", decided.every((e) => e.activity.some((x) => x.type === "escalated")), true);
}
{
  // RTA de-duplication: a row matching a live case is flagged and not re-imported.
  const csv = [
    "Date,Employee Name,Employee ID,Status,Tardy,Missing Hours,Early Departure,Hours can be compenstaed",
    `${D(2)},Sara M,EG0999,NCNS,0,9:00,0,0`,
  ].join("\n");
  const existing = [mk({ date: D(2), empId: "EG0999", email: "", violation: "NCNS" })];
  const a = assessRta(csv, DEFAULT_DCM, existing);
  eq("re-imported RTA row flagged duplicate", [a.counts.duplicate, a.rows[0].cls], [1, "duplicate"]);
  const built = buildEntries(a.rows, { account: "Beko", entries: existing, dcm: DEFAULT_DCM, uploadedBy: "WFM" });
  eq("duplicate is not re-imported", built.entries.length, 0);

  // A voided prior frees the slot — the re-import is allowed back in.
  const voidedExisting = [mk({ date: D(2), empId: "EG0999", email: "", violation: "NCNS", voided: true })];
  eq("voided prior does not block re-import", assessRta(csv, DEFAULT_DCM, voidedExisting).counts.duplicate, 0);

  // Two identical rows in one file: the second is the duplicate.
  const dupFile = [
    "Date,Employee Name,Employee ID,Status,Tardy,Missing Hours,Early Departure,Hours can be compenstaed",
    `${D(2)},Sara M,EG0999,NCNS,0,9:00,0,0`,
    `${D(2)},Sara M,EG0999,NCNS,0,9:00,0,0`,
  ].join("\n");
  eq("intra-file duplicate flagged", assessRta(dupFile, DEFAULT_DCM, []).counts.duplicate, 1);
}
{
  // Dismissal must not re-verdict — the provisional verdict is archived as-is.
  const { decideCases } = await import(`${LIB}/engine.js`);
  const es = [mk({ date: D(2), violation: "NCNS", stage: "review", occurrence: 1, action: "Written Warning + 3-day deduction" })];
  const out = decideCases(es, [es[0].id], "dismissed", { by: "PM", assignee: "", comment: "System outage." }, DEFAULT_DCM);
  eq("dismiss keeps stage + verdict untouched", [out[0].stage, out[0].occurrence], ["dismissed", 1]);
}

console.log("\n── RBAC + password hashing ──");
{
  eq("seven roles incl. Agent and IT", [ROLES.length, ROLES.includes("Agent"), ROLES.includes("ITSupport")], [7, true, true]);
  /* IT exists to unlock people and nothing else. The assertion is the whole
     list rather than a length, because the failure worth catching is a
     permission quietly arriving on the widest-hours team in the building. */
  eq("IT can start and stop a recovery",
    [can({ role: "ITSupport" }, "issueReset"), can({ role: "ITSupport" }, "revokeReset")], [true, true]);
  eq("and can reach nothing else",
    ["employeeRead", "piiRead", "caseWrite", "audit", "admin", "wfmRead", "floorView", "log"]
      .filter((p) => can({ role: "ITSupport" }, p)), []);
  /* Two screens now, and the second is not a widening. "settings" still means
     the system configuration and stays with the admin; "notifications" is what
     *this person* wants to be interrupted about, which every role needs and
     none of which reaches anybody else's data. The assertion that matters is
     unchanged — IT reaches no operational screen. */
  /* The people finder is on every role's list and is not a widening: it carries
     work contact details and who is on shift, and nothing that would need the
     employee record's permission. That thinness is what lets an agent open it. */
  eq("IT sees the help desk, the people finder, thanks and their own preferences",
    TABS_FOR.ITSupport, ["helpdesk", "findpeople", "thanks", "notifications"]);
  eq("and not the system configuration", TABS_FOR.ITSupport.includes("settings"), false);
  eq("no directory, no cases, no pay",
    ["people", "roster", "log", "triage", "agents", "insights", "audit", "wfm"]
      .filter((t) => TABS_FOR.ITSupport.includes(t)), []);

  /* The permission map and the database enum must agree. They are two files
     that both define "what roles exist", and I have now had them disagree
     once: adding ITSupport to auth.js without adding it to the Prisma enum
     produced a login that simply could not be created, with the insert failing
     silently and the sign-in failing for a reason that pointed nowhere near
     the cause. */
  const schemaText = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const dbRoles = /enum Role \{([^}]*)\}/.exec(schemaText)[1]
    .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  eq("every role in auth.js exists in the database enum", ROLES.filter((r) => !dbRoles.includes(r)), []);
  eq("and every database role has permissions defined", dbRoles.filter((r) => !ROLES.includes(r)), []);
  eq("every role has a label", ROLES.filter((r) => !ROLE_LABEL[r]), []);
  eq("and a screen list, even if empty", ROLES.filter((r) => !Array.isArray(TABS_FOR[r])), []);
  eq("nobody else can issue a recovery code",
    ROLES.filter((r) => can({ role: r }, "issueReset")), ["SuperAdmin", "ITSupport"]);
  eq("agents have no workspace tabs", TABS_FOR.Agent.length, 0);
  /* WFM owns the plan and the floor it plays out on — but they still never
     reach the case pipeline, the directory, or anything about a person that is
     not their hours. The exact list is asserted rather than a length, because
     the failure worth catching is a screen quietly appearing in it. */
  /* "exceptions" was added here deliberately, not absorbed. Attendance
     exceptions are adherence — the same question the RTA import answers a day
     late — and WFM already owns both the roster that says who should have been
     there and the floor that says who was. The list stays exact so the next
     addition has to argue for itself the same way. */
  eq("WFM sees planning, the floor, exceptions, the import, the people finder, thanks and their own preferences",
    TABS_FOR.WFM, ["wfm", "floor", "exceptions", "rta", "findpeople", "thanks", "notifications"]);
  eq("and not the system configuration", TABS_FOR.WFM.includes("settings"), false);
  /* The real assertion: nothing operational leaked in with it. */
  eq("and nothing about people, cases or pay",
    ["people", "roster", "log", "triage", "agents", "insights", "audit", "approvals", "joining", "leaving"]
      .filter((t) => TABS_FOR.WFM.includes(t)), []);
  eq("WFM cannot open the directory", TABS_FOR.WFM.includes("people"), false);
  eq("WFM still cannot touch cases", can({ role: "WFM" }, "caseWrite"), false);
  // Fleet-wide roles are unscoped by design: a WFM analyst usually has no direct
  // reports, so a subtree scope would show them themselves and nobody else.
  eq("WFM is fleet-wide for visibility", FLEET_WIDE_ROLES.includes("WFM"), true);
  eq("a lead is not fleet-wide", FLEET_WIDE_ROLES.includes("OperationsLead"), false);
  eq("only agents may acknowledge", [can({ role: "Agent" }, "acknowledge"), can({ role: "SuperAdmin" }, "acknowledge")], [true, false]);
  eq("only SuperAdmin administers", [can({ role: "SuperAdmin" }, "admin"), can({ role: "HRBusinessPartner" }, "admin")], [true, false]);
  eq("HR executes, OPS doesn't", [can({ role: "HRBusinessPartner" }, "hr"), can({ role: "OperationsLead" }, "hr")], [true, false]);
  eq("no user -> no permission", can(null, "triage"), false);

  const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
  eq("bcrypt roundtrip", [bcrypt.compareSync(DEFAULT_PASSWORD, hash), bcrypt.compareSync("nope", hash)], [true, false]);
}

console.log("\n── Warning letter ──");
{
  const { letterModel, letterFilename } = await import(`${LIB}/letter.js`);
  const e = mk({ violation: "NCNS", occurrence: 2, severity: "Moderate", action: "Final Warning + 5-day deduction", deductionApplied: 5, deductionDays: 5, hrRef: "HR-2026-1", account: "Beko", empId: "EG1", email: "a@x", date: "2026-07-01" });
  const m = letterModel(e, { org: "Konecta GDC", date: "2026-07-23" });
  eq("letter title", m.title, "Disciplinary Warning Notice");
  eq("letter subject carries violation + occurrence", m.subject, "NCNS — occurrence No. 2");
  eq("letter reports the applied deduction", m.deductionDays, 5);
  eq("letter body names the prescribed action", m.body.some((p) => p.includes("Final Warning + 5-day deduction")), true);
  eq("letter filename is safe", /^warning-letter-EG1-2026-07-01\.pdf$/.test(letterFilename(e)), true);
  const ser = letterModel(mk({ violation: "Physical assault / threats", severity: "Serious", action: "Termination of Employment" }), {});
  eq("serious case adds the response-window clause", [ser.investigation, ser.body.some((p) => p.includes("3–5 working days"))], [true, true]);
}

console.log("\n── Paginated case query ──");
{
  const { buildCaseQuery } = await import(`${LIB}/entries-query.js`);
  const base = buildCaseQuery();
  eq("defaults: voided excluded, page 1, size 50", [base.where.voided, base.skip, base.take], [false, 0, 50]);
  eq("newest first", base.orderBy[0].date, "desc");
  const q2 = buildCaseQuery({ page: 3, pageSize: 20 });
  eq("page 3 of 20 skips 40", [q2.skip, q2.take], [40, 20]);
  eq("page size is clamped to the max", buildCaseQuery({ pageSize: 9999 }).take, 200);
  eq("page floors at 1", buildCaseQuery({ page: 0 }).page, 1);
  const acc = buildCaseQuery({ account: "Beko" });
  eq("account filter applied", acc.where.account, "Beko");
  eq("account 'All' is not a filter", buildCaseQuery({ account: "All" }).where.account, undefined);
  const filtered = buildCaseQuery({ q: "nour", from: "2026-01-01", to: "2026-12-31", stage: "active", includeVoided: true });
  eq("stage filter + voided included", [filtered.where.stage, filtered.where.voided], ["active", undefined]);
  eq("search builds an OR across email/empId/name", filtered.where.AND.some((c) => Array.isArray(c.OR) && c.OR.length === 3), true);
  eq("date range becomes gte/lte", [filtered.where.AND.some((c) => c.date?.gte === "2026-01-01"), filtered.where.AND.some((c) => c.date?.lte === "2026-12-31")], [true, true]);
}

console.log("\n── Password policy ──");
{
  eq("too short rejected", !!passwordProblem("Ab1"), true);
  eq("missing uppercase rejected", !!passwordProblem("abcdefg1"), true);
  eq("missing lowercase rejected", !!passwordProblem("ABCDEFG1"), true);
  eq("missing digit rejected", !!passwordProblem("Abcdefgh"), true);
  eq("the default is rejected", !!passwordProblem(DEFAULT_PASSWORD), true);
  eq("a strong password passes", passwordProblem("Petrol#2026"), null);
}

console.log("\n── Login rate limiting ──");
const { createLoginLimiter } = await import(`${LIB}/rate-limit.js`);
{
  const lim = createLoginLimiter({ max: 3, windowMs: 1000 });
  const k = "a@x";
  eq("fresh key not blocked, full budget", [lim.status(k, 0).blocked, lim.status(k, 0).remaining], [false, 3]);
  lim.fail(k, 0);
  lim.fail(k, 0);
  eq("2 fails -> 1 left, not blocked", [lim.status(k, 0).remaining, lim.status(k, 0).blocked], [1, false]);
  lim.fail(k, 0);
  eq("hitting max blocks", lim.status(k, 0).blocked, true);
  eq("blocked reports a positive retry", lim.status(k, 0).retryAfterMs > 0, true);
  eq("still blocked inside the window", lim.status(k, 999).blocked, true);
  eq("failures age out of the window", lim.status(k, 1001).blocked, false);
}
{
  const lim = createLoginLimiter({ max: 3, windowMs: 1000 });
  const k = "b@x";
  lim.fail(k, 0);
  lim.fail(k, 0);
  lim.fail(k, 0);
  eq("blocked after 3 fails", lim.status(k, 0).blocked, true);
  lim.succeed(k);
  eq("a success wipes the counter", [lim.status(k, 0).blocked, lim.status(k, 0).remaining, lim._size()], [false, 3, 0]);
}
{
  // Independent identifiers don't share a budget.
  const lim = createLoginLimiter({ max: 2, windowMs: 1000 });
  lim.fail("x@x", 0);
  lim.fail("x@x", 0);
  eq("one key locked leaves another free", [lim.status("x@x", 0).blocked, lim.status("y@y", 0).blocked], [true, false]);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

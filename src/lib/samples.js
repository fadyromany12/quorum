/* A demo ledger.

   Not random filler — each row is placed to exercise one rule, so the dashboard
   has something true to show the moment sample data is loaded:

     · nour.said     three late logins where the third falls outside the 90-day
                     window, so the counter resets to №1
     · karim.adel    a clean 1st → 2nd → 3rd progression on unauthorised absence
     · tarek.hassan  two NCNS in one calendar month — the second is cut by the
                     5-day monthly deduction ceiling, and trips the repeat-NCNS flag
     · dina.samy     seven emergency days: the seventh is past the annual quota
                     and is reclassified as unauthorised absence
     · youssef.hany  three infractions inside 30 days — trips the 3-in-30 flag
*/

import { uid, nameFromEmail } from "./format.js";
import { addDays, todayStr } from "./dates.js";
import { verdictFor } from "./engine.js";
import { LOBS } from "./constants.js";

/** flow: how far through the pipeline the case has travelled. */
const FLOWS = {
  closed: { notified: true, opsConfirmed: true, hrConfirmed: true },
  hr: { notified: true, opsConfirmed: true, hrConfirmed: false },
  ops: { notified: true, opsConfirmed: false, hrConfirmed: false },
  open: { notified: false, opsConfirmed: false, hrConfirmed: false },
};

/* n = days before today. Ordered oldest first so the chains build correctly. */
const RAW = [
  { n: 170, acc: "Hertz", email: "dina.samy@demo.konecta", id: "EG0533", v: "Emergency Leave", min: 480, s: "09:00", e: "17:00", flow: "closed" },
  { n: 150, acc: "Hertz", email: "dina.samy@demo.konecta", id: "EG0533", v: "Emergency Leave", min: 480, s: "09:00", e: "17:00", flow: "closed" },
  { n: 130, acc: "Hertz", email: "dina.samy@demo.konecta", id: "EG0533", v: "Emergency Leave", min: 480, s: "09:00", e: "17:00", flow: "closed" },
  { n: 120, acc: "Lenovo", email: "nour.said@demo.konecta", id: "EG0412", v: "Late login / tardy", min: 25, s: "10:00", e: "19:00", flow: "closed" },
  { n: 110, acc: "Hertz", email: "dina.samy@demo.konecta", id: "EG0533", v: "Emergency Leave", min: 480, s: "09:00", e: "17:00", flow: "closed" },
  { n: 100, acc: "Lenovo", email: "nour.said@demo.konecta", id: "EG0412", v: "Late login / tardy", min: 30, s: "10:00", e: "19:00", flow: "closed" },
  { n: 90, acc: "Hertz", email: "dina.samy@demo.konecta", id: "EG0533", v: "Emergency Leave", min: 480, s: "09:00", e: "17:00", flow: "closed" },
  { n: 64, acc: "Lenovo", email: "youssef.hany@demo.konecta", id: "EG0470", v: "Exceeding break time", min: 18, s: "10:00", e: "19:00", flow: "closed" },
  { n: 55, acc: "Hertz", email: "mona.farid@demo.konecta", id: "EG0521", v: "Sick Leave", min: 480, s: "09:00", e: "17:00", sick: true, flow: "closed", ev: "MedCert #EG0521-2026-03 (HR records)" },
  { n: 50, acc: "Lenovo", email: "karim.adel@demo.konecta", id: "EG0388", v: "Unauthorised absence", min: 540, s: "10:00", e: "19:00", flow: "closed" },
  { n: 40, acc: "Hertz", email: "aya.magdy@demo.konecta", id: "EG0517", v: "Annual Leave", min: 0, s: "09:00", e: "17:00", flow: "closed" },
  { n: 28, acc: "Lenovo", email: "youssef.hany@demo.konecta", id: "EG0470", v: "Late login / tardy", min: 22, s: "10:00", e: "19:00", flow: "closed" },
  { n: 20, acc: "Lenovo", email: "karim.adel@demo.konecta", id: "EG0388", v: "Unauthorised absence", min: 540, s: "10:00", e: "19:00", flow: "closed" },
  { n: 12, acc: "Beko", email: "tarek.hassan@demo.konecta", id: "EG0644", v: "NCNS", min: 540, s: "12:00", e: "21:00", flow: "hr" },
  { n: 10, acc: "Lenovo", email: "youssef.hany@demo.konecta", id: "EG0470", v: "Leaving floor / early departure", min: 95, s: "10:00", e: "19:00", flow: "ops" },
  { n: 8, acc: "Beko", email: "omar.lotfy@demo.konecta", id: "EG0602", v: "Leaving floor / early departure", min: 95, s: "12:00", e: "21:00", flow: "closed" },
  { n: 5, acc: "Lenovo", email: "nour.said@demo.konecta", id: "EG0412", v: "Late login / tardy", min: 40, s: "10:00", e: "19:00", dismissed: "System outage at login — confirmed with RTA, not the agent's fault." },
  { n: 5, acc: "Lenovo", email: "youssef.hany@demo.konecta", id: "EG0470", v: "Case documentation failure", min: 0, s: "10:00", e: "19:00", flow: "ops" },
  { n: 4, acc: "Beko", email: "tarek.hassan@demo.konecta", id: "EG0644", v: "NCNS", min: 540, s: "12:00", e: "21:00", flow: "ops" },
  { n: 3, acc: "Hertz", email: "dina.samy@demo.konecta", id: "EG0533", v: "Emergency Leave", min: 480, s: "09:00", e: "17:00", flow: "closed" },
  { n: 2, acc: "Hertz", email: "dina.samy@demo.konecta", id: "EG0533", v: "Emergency Leave", min: 480, s: "09:00", e: "17:00", flow: "hr" },
  { n: 2, acc: "Lenovo", email: "karim.adel@demo.konecta", id: "EG0388", v: "Unauthorised absence", min: 540, s: "10:00", e: "19:00", flow: "hr" },
  { n: 1, acc: "Lenovo", email: "sara.adly@demo.konecta", id: "EG0455", v: "CSAT survey manipulation", min: 0, s: "10:00", e: "19:00", review: true, ev: "https://qa.konecta.example/reviews/EG0455-csat" },
  { n: 1, acc: "Lenovo", email: "nour.said@demo.konecta", id: "EG0412", v: "Late login / tardy", min: 15, s: "10:00", e: "19:00", review: true },
  { n: 0, acc: "Beko", email: "ahmed.zaki@demo.konecta", id: "EG0688", v: "Sleeping / resting at workstation", min: 0, s: "12:00", e: "21:00", review: true },
];

export function buildSamples(tls, dcm) {
  const today = todayStr();
  const entries = [];

  RAW.forEach((r, i) => {
    const date = addDays(today, -r.n);
    const stage = r.review ? "review" : r.dismissed ? "dismissed" : "active";
    const tl = tls[i % tls.length];
    const loggedAt = Date.now() - r.n * 86400000;

    // Verdict is computed against the entries already built, exactly as it would
    // have been on the day — that is what makes the chains and caps come out right.
    const v = verdictFor(r.v, r.email, date, entries, dcm);
    const flow = FLOWS[r.flow] || FLOWS.open;
    const hrNeeded = v.disciplinary && v.executor === "HR";

    const activity = [];
    if (stage === "active") {
      activity.push({ at: loggedAt + 3600e3, by: tl, type: "escalated", text: "Verified against RTA data — proceeding per the matrix." });
    }
    if (stage === "dismissed") {
      activity.push({ at: loggedAt + 3600e3, by: tl, type: "dismissed", text: r.dismissed });
    }

    entries.push({
      id: uid(),
      account: r.acc,
      lob: LOBS[i % LOBS.length],
      date,
      email: r.email,
      empId: r.id,
      agentName: nameFromEmail(r.email),
      tl,
      executorName: tl,
      tardyMin: 0,
      earlyMin: 0,
      compMin: 0,
      shiftStart: r.s,
      shiftEnd: r.e,
      violation: r.v,
      sickNote: !!r.sick,
      missingMin: r.min,
      evidenceUrl: r.ev || "",
      occurrence: v.occ,
      action: v.action,
      executor: v.executor,
      severity: v.severity,
      disciplinary: v.disciplinary,
      deductionDays: v.cap.prescribed,
      deductionApplied: stage === "dismissed" ? 0 : v.cap.applied,
      reclassifiedFrom: v.reclassifiedFrom || "",
      notes: "Sample entry",
      stage,
      assignee: stage === "review" ? "" : tl,
      activity,
      notified: stage === "active" && flow.notified,
      opsConfirmed: stage === "active" && flow.opsConfirmed,
      hrNeeded,
      hrConfirmed: stage === "active" && hrNeeded && flow.hrConfirmed,
      hrRef: stage === "active" && hrNeeded && flow.hrConfirmed ? `HR-${date.slice(0, 4)}-${1000 + i}` : "",
      actionDate: stage === "active" && flow.opsConfirmed ? addDays(date, 1) : "",
      createdAt: loggedAt,
    });
  });

  return entries.reverse(); // newest first, matching the log view
}

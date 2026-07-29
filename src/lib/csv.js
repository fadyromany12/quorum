/* Weekly PMO export — the full transactional ledger, one row per case. */

import { csvCell } from "./format.js";
import { todayStr } from "./dates.js";
import { statusOf } from "./engine.js";

const HEAD = [
  "Account",
  "LOB",
  "Date",
  "Agent Name",
  "Agent Email",
  "Employee ID",
  "Logged By",
  "Assignee",
  "Shift Start",
  "Shift End",
  "Violation",
  "Reclassified From",
  "Severity",
  "Sick Note",
  "Occurrence",
  "Action",
  "Executor",
  "Deduction Prescribed (days)",
  "Deduction Applied (days)",
  "Deduction Waived by Cap (days)",
  "Tardy (min)",
  "Early Departure (min)",
  "Compensable (min)",
  "Missing Minutes (net)",
  "Stage",
  "Review Comment",
  "Agent Notified",
  "OPS Confirmed",
  "HR Needed",
  "HR Confirmed",
  "HR Reference",
  "Action Date",
  "Status",
  "Evidence",
  "Notes",
];

export function toCsv(entries) {
  const rows = entries.map((e) => {
    const review = (e.activity || []).find((a) => a.type === "escalated" || a.type === "dismissed");
    const prescribed = e.deductionDays || 0;
    const applied = e.deductionApplied || 0;
    return [
      e.account,
      e.lob || "",
      e.date,
      e.agentName || "",
      e.email,
      e.empId,
      e.tl,
      e.assignee,
      e.shiftStart,
      e.shiftEnd,
      e.violation,
      e.reclassifiedFrom || "",
      e.severity || "",
      e.sickNote ? "Yes" : "No",
      e.occurrence ?? "",
      e.action,
      e.executor,
      prescribed,
      applied,
      Math.max(0, prescribed - applied),
      e.tardyMin || 0,
      e.earlyMin || 0,
      e.compMin || 0,
      e.missingMin,
      e.stage,
      review ? `${review.by}: ${review.text}` : "",
      e.notified ? "Yes" : "No",
      e.opsConfirmed ? "Yes" : "No",
      e.hrNeeded ? "Yes" : "No",
      e.hrConfirmed ? "Yes" : "No",
      e.hrRef || "",
      e.actionDate,
      statusOf(e),
      e.evidenceUrl || "",
      e.notes,
    ];
  });
  return [HEAD, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

export function downloadCsv(entries) {
  // A BOM so Excel opens the Arabic-capable UTF-8 without mangling it.
  const blob = new Blob(["﻿" + toCsv(entries)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `quorum-case-log-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

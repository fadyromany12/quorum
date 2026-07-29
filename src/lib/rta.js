/* RTA bulk import.

   WFM exports the daily Real-Time Adherence sheet and drops it here. This
   module owns the whole journey from raw text to committable case entries:

     parseCsv     — text -> rows, handling quotes, embedded commas/newlines,
                    CRLF, and comma- or tab-delimited files
     mapHeaders   — finds the header row and maps the RTA column names
                    (including the sheet's own typo "compenstaed")
     assessRows   — per row: identity, times, violation, compensation, and a
                    classification: clean | compensated | irregular | error
     buildEntries — assessed rows -> case entries, verdicts computed in date
                    order so two incidents for one agent in the same file
                    chain correctly

   Only .csv/.tsv/.txt text is parsed. True .xlsx needs a spreadsheet library;
   the uploader tells users to export as CSV instead. */

import { uid } from "./format.js";
import { todayStr } from "./dates.js";
import { verdictFor } from "./engine.js";
import { applyCompensation, AUTO_ACK_ACTION } from "./compensation.js";

/* ── CSV parsing ─────────────────────────────────────────────────────────── */

export function parseCsv(text) {
  const src = String(text || "").replace(/^﻿/, "");
  // Sniff the delimiter from the first line: RTA exports are comma or tab.
  const firstLine = src.slice(0, src.indexOf("\n") + 1 || src.length);
  const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t" : ",";

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/* ── Header mapping ──────────────────────────────────────────────────────── */

const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* Ordered: first pattern that matches a squashed header claims the field.
   "statusviolation" must come before plain "status". */
const HEADER_PATTERNS = [
  ["violation", /^statusviolation$|^violation/],
  ["lob", /^lob$|lineofbusiness/],
  ["date", /^date$|^day$|shiftdate/],
  ["name", /employeename|agentname|^name$/],
  ["empId", /employeeid|agentid|^empid$|^id$/],
  ["shiftStart", /shiftstart|^start/],
  ["shiftEnd", /shiftend|^end/],
  ["executor", /executor/],
  ["tardy", /^tardy/],
  ["missing", /missinghours|^missing/],
  ["early", /earlydeparture|^early/],
  // The production RTA sheet header is misspelled "Hours can be compenstaed";
  // match both spellings and any "compensat…" variant.
  ["comp", /compenst?a/],
  ["status", /^status$/],
];

export function mapHeaders(row) {
  const map = {};
  row.forEach((cell, idx) => {
    const key = squash(cell);
    if (!key) return;
    for (const [field, re] of HEADER_PATTERNS) {
      if (re.test(key) && map[field] === undefined) {
        map[field] = idx;
        return;
      }
    }
  });
  return map;
}

/** The header row is the first one that maps at least 3 known RTA columns. */
export function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const map = mapHeaders(rows[i]);
    if (Object.keys(map).length >= 3) return { index: i, map };
  }
  return null;
}

/* ── Value parsing ───────────────────────────────────────────────────────── */

/** "0:25" -> 25 min · "9:00" -> 540 · "1.5" -> 90 (decimal hours) · "" -> 0. */
export function parseDur(v) {
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const hm = /^(\d{1,3}):(\d{1,2})$/.exec(s);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : 0;
}

/** ISO, DD/MM/YYYY or MM/DD/YYYY (disambiguated by value; ties read DD/MM —
    the RTA sheets are Egyptian). Returns "" when unparseable. */
export function parseRtaDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (dmy) {
    let [, a, b, y] = dmy;
    let day = Number(a);
    let mon = Number(b);
    if (mon > 12 && day <= 12) [day, mon] = [mon, day];
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return "";
    return `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return "";
}

/* ── Violation resolution ────────────────────────────────────────────────── */

const KEYWORDS = [
  [/ncns|no\s*call\s*no\s*show/i, "NCNS"],
  [/unauthori[sz]ed|absent/i, "Unauthorised absence"],
  [/sick/i, "Sick Leave"],
  [/emergenc/i, "Emergency Leave"],
  [/annual|vacation/i, "Annual Leave"],
  [/late|tardy/i, "Late login / tardy"],
  [/early|left\s*early|departure/i, "Leaving floor / early departure"],
];

const PRESENT_RE = /^(present|on\s*time|ok|normal|attended|-)?$/i;

function resolveViolation({ violationText, statusText, tardyMin, missingMin, earlyMin }, dcm) {
  // 1. The violation column may name a DCM rule outright.
  const explicit = String(violationText || "").trim();
  if (explicit) {
    const exact = dcm.find((r) => r.name.toLowerCase() === explicit.toLowerCase());
    if (exact) return exact.name;
    for (const [re, name] of KEYWORDS) if (re.test(explicit)) return name;
  }
  // 2. The status column ("Absent", "NCNS", "Tardy"…).
  const status = String(statusText || "").trim();
  if (status && !PRESENT_RE.test(status)) {
    for (const [re, name] of KEYWORDS) if (re.test(status)) return name;
  }
  // 3. Fall back to whichever clock figure is the incident.
  if (tardyMin > 0) return "Late login / tardy";
  if (missingMin > 0) return "Unauthorised absence";
  if (earlyMin > 0) return "Leaving floor / early departure";
  return "";
}

/* ── Assessment ──────────────────────────────────────────────────────────── */

/**
 * @returns {{header:object|null, rows:Array, counts:object, error?:string}}
 * Each row: raw fields + { violation, lost, comp, net, cls, err }
 *   cls: "clean" | "compensated" | "irregular" | "error"
 */
/** Natural key for RTA de-duplication: one agent, one day, one violation. */
export const rtaKeyOf = (id, name, date, violation) =>
  `${String(id || name || "").trim().toLowerCase()}|${date}|${violation}`;

/**
 * @param {string} text   the raw sheet
 * @param {Array}  dcm    the matrix
 * @param {Array}  existing  the current ledger — rows matching a live case (or an
 *                 earlier row in the same file) are flagged as duplicates and
 *                 will not re-import. Defaults to none.
 */
export function assessRta(text, dcm, existing = []) {
  const parsed = parseCsv(text);
  if (!parsed.length) return { header: null, rows: [], counts: {}, error: "The file is empty." };

  // Voided cases free their slot — a re-import after voiding is intentional.
  const seen = new Set(
    (existing || []).filter((e) => !e.voided).map((e) => rtaKeyOf(e.empId, e.agentName, e.date, e.violation))
  );

  const header = findHeader(parsed);
  if (!header) {
    return {
      header: null,
      rows: [],
      counts: {},
      error: "No RTA header row found — expected columns like LOB, Date, Employee Name, Employee ID, Tardy, Missing Hours.",
    };
  }
  const { index, map } = header;
  const cell = (row, field) => (map[field] === undefined ? "" : String(row[map[field]] ?? "").trim());

  const rows = parsed.slice(index + 1).map((raw, i) => {
    const tardyMin = parseDur(cell(raw, "tardy"));
    const missingMin = parseDur(cell(raw, "missing"));
    const earlyMin = parseDur(cell(raw, "early"));
    const compMin = parseDur(cell(raw, "comp"));
    const comp = applyCompensation({ tardyMin, missingMin, earlyMin, compMin });

    const row = {
      line: index + 2 + i,
      lob: cell(raw, "lob"),
      date: parseRtaDate(cell(raw, "date")),
      rawDate: cell(raw, "date"),
      name: cell(raw, "name"),
      empId: cell(raw, "empId").toUpperCase(),
      shiftStart: cell(raw, "shiftStart"),
      shiftEnd: cell(raw, "shiftEnd"),
      status: cell(raw, "status"),
      executor: cell(raw, "executor"),
      tardyMin,
      missingMin,
      earlyMin,
      compMin,
      lost: comp.lost,
      comp: comp.comp,
      net: comp.net,
      violation: "",
      cls: "clean",
      err: "",
    };

    row.violation = resolveViolation(
      { violationText: cell(raw, "violation"), statusText: row.status, tardyMin, missingMin, earlyMin },
      dcm
    );

    if (!row.empId && !row.name) {
      row.cls = "error";
      row.err = "No employee ID or name";
    } else if (!row.date) {
      row.cls = "error";
      row.err = row.rawDate ? `Unreadable date “${row.rawDate}”` : "Missing date";
    } else if (row.date > todayStr()) {
      row.cls = "error";
      row.err = `Future date ${row.date}`;
    } else if (!row.violation && row.lost === 0) {
      row.cls = "clean";
    } else if (comp.fullyCompensated && row.violation && !isLeave(row.violation, dcm)) {
      row.cls = "compensated";
    } else {
      row.cls = "irregular";
    }

    // De-dupe rows that would otherwise create a case: a match against the live
    // ledger or an earlier row in this same file is flagged, not re-imported.
    if (row.cls === "irregular" || row.cls === "compensated") {
      const key = rtaKeyOf(row.empId, row.name, row.date, row.violation);
      if (seen.has(key)) {
        row.cls = "duplicate";
        row.err = "Already logged — duplicate";
      } else {
        seen.add(key);
      }
    }
    return row;
  });

  const counts = { clean: 0, compensated: 0, irregular: 0, error: 0, duplicate: 0 };
  rows.forEach((r) => counts[r.cls]++);
  return { header, rows, counts };
}

const isLeave = (violation, dcm) => !dcm.some((r) => r.name === violation);

/* ── Committing ──────────────────────────────────────────────────────────── */

/**
 * Turn assessed rows into case entries.
 *
 * Irregular rows land at the triage gate ("review"); fully-compensated rows
 * are logged closed as Approved / Acknowledged; clean and error rows produce
 * nothing. Verdicts are computed oldest-first against the growing ledger so
 * same-file recurrences chain, exactly as samples.js replays history.
 */
export function buildEntries(assessed, { account, entries, dcm, uploadedBy }) {
  const usable = assessed
    .filter((r) => r.cls === "irregular" || r.cls === "compensated")
    .sort((a, b) => a.date.localeCompare(b.date));

  const working = [...entries];
  const out = [];

  for (const r of usable) {
    const agent = { email: "", empId: r.empId };
    const base = {
      id: uid(),
      account,
      lob: r.lob,
      date: r.date,
      email: "",
      empId: r.empId,
      agentName: r.name,
      tl: r.executor || uploadedBy,
      executorName: r.executor,
      shiftStart: r.shiftStart || "—",
      shiftEnd: r.shiftEnd || "—",
      sickNote: false,
      tardyMin: r.tardyMin,
      earlyMin: r.earlyMin,
      compMin: r.compMin,
      missingMin: r.net, // net of compensation — this is what analytics count
      notes: `RTA import · status “${r.status || "—"}”${r.comp > 0 ? ` · ${r.comp} min compensated` : ""}`,
      assignee: "",
      notified: false,
      opsConfirmed: false,
      hrConfirmed: false,
      hrRef: "",
      actionDate: "",
      createdAt: Date.now(),
    };

    let entry;
    if (r.cls === "compensated") {
      // Fully made up — auto-acknowledged, closed, never disciplinary.
      entry = {
        ...base,
        violation: r.violation,
        occurrence: null,
        action: AUTO_ACK_ACTION,
        executor: "TL",
        severity: null,
        disciplinary: false,
        deductionDays: 0,
        deductionApplied: 0,
        reclassifiedFrom: "",
        stage: "active",
        notified: true,
        opsConfirmed: true,
        hrNeeded: false,
        actionDate: r.date,
        activity: [
          {
            at: Date.now(),
            by: uploadedBy,
            type: "comment",
            text: `Auto-acknowledged on RTA import — ${r.comp} of ${r.lost} lost minutes compensated in full.`,
          },
        ],
      };
    } else {
      const v = verdictFor(r.violation, agent, r.date, working, dcm);
      entry = {
        ...base,
        violation: r.violation,
        occurrence: v.occ,
        action: v.action,
        executor: v.executor,
        severity: v.severity,
        disciplinary: v.disciplinary,
        deductionDays: v.cap.prescribed,
        deductionApplied: v.cap.applied,
        reclassifiedFrom: v.reclassifiedFrom || "",
        stage: "review",
        hrNeeded: v.executor === "HR",
        activity: [{ at: Date.now(), by: uploadedBy, type: "comment", text: "Imported from the RTA sheet." }],
      };
    }
    working.push(entry);
    out.push(entry);
  }

  return { entries: out, toTriage: out.filter((e) => e.stage === "review").length, acked: out.length - out.filter((e) => e.stage === "review").length };
}

/** A ready-to-edit template in the exact production column order. */
export const TEMPLATE_CSV = [
  "LOB,Date,Employee Name,Employee ID,Shift Start,Shift End,Status,Executor Name,Tardy,Missing Hours,Early Departure,Hours can be compenstaed,Status / Violation",
  `EMEA,${todayStr()},Nour Said,EG0412,10:00,19:00,Tardy,Ahmed Nagi,0:25,0,0,0,Late login`,
  `GTAP,${todayStr()},Karim Adel,EG0388,10:00,19:00,Absent,Ahmed Nagi,0,9:00,0,0,Unauthorised absence`,
  `EMEA,${todayStr()},Mona Farid,EG0521,09:00,17:00,Tardy,Ahmed Nagi,0:45,0,0,0:45,`,
  `North America,${todayStr()},Omar Lotfy,EG0602,12:00,21:00,Present,Ahmed Nagi,0,0,0,0,`,
].join("\n");

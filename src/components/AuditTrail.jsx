"use client";

/* Tab H — the audit trail, finally visible.

   Every state change in the system writes an immutable row; this view is the
   read side: a reverse-chronological stream with action filtering and free-
   text search. Nothing here mutates — the API has no write surface for it. */

import { useEffect, useMemo, useState } from "react";
import { ScrollText, Search, RefreshCw, Signature, Gavel, UploadCloud, UserCog, KeyRound, Settings2, Table2, Trash2, ClipboardPlus, Pencil, Bomb, LogIn, ShieldAlert, Ban, Archive, Scale, IdCard, GitBranch, Eye, Lock } from "lucide-react";
import { Card, Pill, Muted, BtnGhost } from "./ui/index.jsx";
import { P } from "../lib/tokens.js";
import { fmtStamp, plural } from "../lib/format.js";
import { ROLE_LABEL } from "../lib/auth.js";

/* Every action the API writes, with a color and an icon so the stream scans. */
const ACTIONS = {
  CASE_CREATED: { label: "Logged", color: P.petrol, icon: ClipboardPlus },
  CASE_DECIDED: { label: "Decided", color: P.amber, icon: Gavel },
  CASE_UPDATED: { label: "Updated", color: P.sub, icon: Pencil },
  CASE_DELETED: { label: "Deleted", color: P.brick, icon: Trash2 },
  CASE_VOIDED: { label: "Voided", color: "var(--dim)", icon: Archive },
  CASE_ACKNOWLEDGED: { label: "Signed", color: "var(--deep-accent)", icon: Signature },
  RTA_IMPORTED: { label: "RTA import", color: P.petrol, icon: UploadCloud },
  DCM_UPDATED: { label: "Matrix", color: P.amber, icon: Table2 },
  CONFIG_UPDATED: { label: "Config", color: P.sub, icon: Settings2 },
  USER_CREATED: { label: "User +", color: P.green, icon: UserCog },
  USER_UPDATED: { label: "User Δ", color: P.sub, icon: UserCog },
  USER_DELETED: { label: "User −", color: P.brick, icon: UserCog },
  USER_PASSWORD_CHANGED: { label: "Password", color: P.sub, icon: KeyRound },
  FACTORY_RESET: { label: "Reset", color: P.brick, icon: Bomb },
  LOGIN_SUCCEEDED: { label: "Login", color: P.green, icon: LogIn },
  LOGIN_FAILED: { label: "Login ✗", color: P.amber, icon: ShieldAlert },
  LOGIN_BLOCKED: { label: "Blocked", color: P.brick, icon: Ban },
  APPEAL_SUBMITTED: { label: "Appeal", color: P.amber, icon: Gavel },
  APPEAL_RESOLVED: { label: "Appeal ✓", color: P.petrol, icon: Scale },
  EMPLOYEE_CREATED: { label: "Employee +", color: P.green, icon: IdCard },
  EMPLOYEE_UPDATED: { label: "Employee Δ", color: P.sub, icon: IdCard },
  EMPLOYEE_STAGE_CHANGED: { label: "Lifecycle", color: P.petrol, icon: GitBranch },
  // Brick, not grey: a PII read is the highest-sensitivity event in the log and
  // should be the first thing the eye lands on when scanning for it.
  PII_READ: { label: "PII viewed", color: P.brick, icon: Eye },
  PII_UPDATED: { label: "PII edited", color: P.amber, icon: Lock },
};

export default function AuditTrail() {
  const [rows, setRows] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [action, setAction] = useState("All");

  const load = async () => {
    setError("");
    try {
      const res = await fetch("/api/audit?limit=500");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load the audit log.");
      setRows(json.audit);
    } catch (err) {
      setError(err.message);
      setRows([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (action !== "All" && r.action !== action) return false;
      if (!needle) return true;
      return (
        r.summary.toLowerCase().includes(needle) ||
        r.actorName.toLowerCase().includes(needle) ||
        (r.caseId || "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q, action]);

  const presentActions = useMemo(() => (rows ? [...new Set(rows.map((r) => r.action))] : []), [rows]);

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <ScrollText size={14} />
          Audit trail — append-only
        </span>
      }
      right={
        <div className="flex items-center gap-2">
          {rows && (
            <span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>
              {plural(visible.length, "event")}
            </span>
          )}
          <BtnGhost onClick={load} icon={RefreshCw}>
            Refresh
          </BtnGhost>
        </div>
      }
    >
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div
          className="flex items-center gap-2"
          style={{ border: `1px solid ${P.line}`, background: "var(--well)", borderRadius: 999, padding: "5px 12px", width: 240 }}
        >
          <Search size={13} color={P.sub} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Actor, summary, case id…"
            style={{ border: "none", background: "transparent", outline: "none", fontSize: 12.5, color: P.ink, flex: 1, minWidth: 0 }}
          />
        </div>
        <button
          onClick={() => setAction("All")}
          className="ao-disp uppercase tracking-wide font-semibold"
          style={{
            fontSize: 11, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
            border: `1px solid ${action === "All" ? P.petrol : P.line}`,
            color: action === "All" ? "#fff" : P.sub,
            background: action === "All" ? P.petrol : "transparent",
          }}
        >
          All
        </button>
        {presentActions.map((a) => {
          const meta = ACTIONS[a] || { label: a, color: P.sub };
          const on = action === a;
          return (
            <button
              key={a}
              onClick={() => setAction(on ? "All" : a)}
              className="ao-disp uppercase tracking-wide font-semibold"
              style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${on ? meta.color : P.line}`,
                color: on ? "var(--chip-on-text)" : meta.color,
                background: on ? meta.color : "transparent",
              }}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{ fontSize: 13, color: P.brick }} role="alert">
          {error}
        </div>
      )}
      {rows === null && (
        <div className="grid gap-1.5" aria-busy="true" aria-label="Loading the audit trail">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-start gap-3 p-2.5" style={{ background: P.mist, borderRadius: 10 }}>
              <div className="ao-skeleton" style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, marginTop: 2 }} />
              <div className="flex-1 grid gap-1.5">
                <div className="ao-skeleton" style={{ height: 11, width: `${38 + ((i * 13) % 26)}%` }} />
                <div className="ao-skeleton" style={{ height: 10, width: `${62 + ((i * 17) % 30)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {rows !== null && !error && visible.length === 0 && <Muted>No events match.</Muted>}

      <div className="grid gap-1.5">
        {visible.map((r) => {
          const meta = ACTIONS[r.action] || { label: r.action, color: P.sub, icon: ScrollText };
          const Icon = meta.icon;
          return (
            <div
              key={r.id}
              className="flex items-start gap-3 p-2.5 ao-lift"
              style={{ background: P.mist, borderRadius: 10, borderLeft: `3px solid ${meta.color}` }}
            >
              <Icon size={14} color={meta.color} style={{ flexShrink: 0, marginTop: 2 }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Pill color={meta.color}>{meta.label}</Pill>
                  <span style={{ fontSize: 12.5, color: P.ink, fontWeight: 500 }}>{r.actorName}</span>
                  <span style={{ fontSize: 11, color: P.sub }}>{ROLE_LABEL[r.actorRole] || r.actorRole}</span>
                  <span className="flex-1" />
                  <span className="ao-mono" style={{ fontSize: 11, color: P.sub, whiteSpace: "nowrap" }}>
                    {fmtStamp(r.at)}
                  </span>
                </div>
                <div className="mt-0.5" style={{ fontSize: 12.5, color: P.inkSoft, overflowWrap: "anywhere" }}>
                  {r.summary}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

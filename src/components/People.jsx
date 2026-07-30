"use client";

/* Tab — the people directory.

   The one screen that answers "who works here, and where do they stand". It is
   the entry point to every employee record, so it loads a server-filtered,
   server-paginated window rather than the whole roster: the directory is the
   first thing that grows past a screenful, and the last thing that should be
   fetched whole. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Users, Search, RefreshCw, ChevronLeft, ChevronRight, Building2, UserPlus,
  CalendarDays, ShieldCheck, ArrowUpRight,
} from "lucide-react";
import { Card, Pill, Muted, BtnGhost } from "./ui/index.jsx";
import { P } from "../lib/tokens.js";
import { plural } from "../lib/format.js";
import { STAGES, displayName, completedYears } from "../lib/employee.js";
import { todayStr } from "../lib/dates.js";
import EmployeeProfile from "./EmployeeProfile.jsx";
import AdmitPerson from "./AdmitPerson.jsx";
import { can } from "../lib/auth.js";

/* Stage colours carry meaning, so they map onto the palette's semantics rather
   than being picked for variety: green is fine, amber wants attention, brick is
   an ending, dim is not yet or no longer staff. */
const STAGE_STYLE = {
  Applicant: { color: "var(--dim)", label: "Applicant" },
  Onboarding: { color: P.petrol, label: "Onboarding" },
  Probation: { color: P.amber, label: "Probation" },
  Active: { color: P.green, label: "Active" },
  OnPip: { color: P.amber, label: "On PIP" },
  Suspended: { color: P.brick, label: "Suspended" },
  Notice: { color: P.brick, label: "Notice" },
  Exited: { color: "var(--dim)", label: "Exited" },
};

const PAGE_SIZE = 24;

function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "··";
  return (parts[0][0] + (parts[parts.length - 1][0] || "")).toUpperCase();
}

/* A stable colour per person so the same face keeps the same tile between
   renders — deterministic from the id, not random. */
function tintFor(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
  return `var(--acc-${(h % 3) + 1})`;
}

function Avatar({ employee, size = 38 }) {
  const tint = tintFor(employee.id);
  return (
    <div
      className="grid place-items-center flex-shrink-0 ao-disp font-semibold"
      style={{
        width: size, height: size, borderRadius: 12,
        background: `color-mix(in srgb, ${tint} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tint} 34%, transparent)`,
        color: tint, fontSize: size * 0.34, letterSpacing: 0.3,
      }}
      aria-hidden="true"
    >
      {initialsOf(employee.fullNameEn)}
    </div>
  );
}

function StageChip({ stage }) {
  const s = STAGE_STYLE[stage] || { color: P.sub, label: stage };
  return <Pill color={s.color}>{s.label}</Pill>;
}

function PersonCard({ employee, managerName, onOpen }) {
  const today = todayStr();
  const years = employee.hireDate ? completedYears(employee.hireDate, today) : null;
  /* Server-derived: Art. 47's age-50 route needs a birth date, and the
     directory deliberately does not ship one. */
  const entitlement = employee.entitlementDays ?? 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(employee.id)}
      className="ao-lift text-left w-full"
      style={{
        background: P.card, border: `1px solid ${P.line}`, borderRadius: 14,
        padding: 14, display: "grid", gap: 10, cursor: "pointer",
      }}
      aria-label={`Open ${displayName(employee)}'s record`}
    >
      <div className="flex items-start gap-3">
        <Avatar employee={employee} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 13.5, fontWeight: 600, color: P.ink }}>{displayName(employee)}</span>
            <StageChip stage={employee.stage} />
          </div>
          <div className="ao-mono" style={{ fontSize: 11, color: P.sub, marginTop: 2 }}>
            {employee.empId}
          </div>
          {employee.fullNameAr && (
            <div dir="rtl" style={{ fontSize: 12, color: P.sub, marginTop: 1 }}>
              {employee.fullNameAr}
            </div>
          )}
        </div>
        <ArrowUpRight size={14} color={P.sub} style={{ flexShrink: 0, marginTop: 2 }} />
      </div>

      <div style={{ fontSize: 12.5, color: P.inkSoft }}>{employee.jobTitle || "—"}</div>

      <div className="flex items-center gap-3 flex-wrap" style={{ fontSize: 11, color: P.sub }}>
        {employee.account && (
          <span className="inline-flex items-center gap-1">
            <Building2 size={11} />
            {employee.account}
            {employee.lob ? ` · ${employee.lob}` : ""}
          </span>
        )}
        {years !== null && (
          <span className="inline-flex items-center gap-1" title={`Joined ${employee.hireDate}`}>
            <CalendarDays size={11} />
            {years === 0 ? "<1 yr" : plural(years, "yr")}
          </span>
        )}
        {entitlement > 0 && (
          <span className="inline-flex items-center gap-1" title="Annual leave entitlement — Law 12/2003 Art. 47">
            <ShieldCheck size={11} />
            {entitlement} d/yr
          </span>
        )}
      </div>

      {managerName && (
        <div style={{ fontSize: 11, color: P.sub, borderTop: `1px solid ${P.line}`, paddingTop: 8 }}>
          Reports to <span style={{ color: P.inkSoft }}>{managerName}</span>
        </div>
      )}
    </button>
  );
}

/**
 * The directory, and the journey views built on it.
 *
 * `stages` narrows the whole screen to one phase of employment — the "New
 * joiners" and "Leavers" screens are this component with a preset rather than
 * two more implementations of search, paging and the profile view. Inside a
 * preset the chips filter *within* the phase, so a stage outside it can never
 * be reached by accident.
 */
export default function People({
  accounts = [], me = null, stages = null, heading = "People", blurb = "",
}) {
  const [rows, setRows] = useState(null); // null = loading
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("All");
  const [stage, setStage] = useState("All");
  const [includeExited, setIncludeExited] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [admitting, setAdmitting] = useState(false);

  /* Names for the "reports to" line. Manager ids come back on every row, but
     the manager themselves may be outside the current page — so the lookup is
     built from whatever has been seen, and simply omits what it cannot resolve
     rather than firing a request per card. */
  const [nameById, setNameById] = useState({});

  // Debounce the search so typing doesn't fire a query per keystroke.
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Any filter change invalidates the current page number.
  /* Keyed on the preset's *contents*, not the array's identity. A parent that
     builds the list inline hands over a new array every render, and an effect
     that depends on the reference would re-fire forever. */
  const stageKey = (stages ?? []).join(",");
  useEffect(() => setPage(1), [debouncedQ, account, stage, includeExited, stageKey]);

  /* Guards against a slow early request landing after a fast later one and
     overwriting it with stale rows. */
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqRef.current;
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedQ) params.set("q", debouncedQ);
    if (account !== "All") params.set("account", account);
    /* A chip narrows within the phase; with no chip the whole phase is asked
       for. The preset is never dropped — that is what makes it a preset and not
       a default. */
    if (stage !== "All") params.set("stage", stage);
    else if (stageKey) params.set("stage", stageKey);
    if (includeExited) params.set("includeExited", "1");

    try {
      const res = await fetch(`/api/employees?${params}`);
      const json = await res.json().catch(() => ({}));
      if (seq !== reqRef.current) return; // a newer request already answered
      if (!res.ok) throw new Error(json.error || "Could not load the directory.");
      setRows(json.employees);
      setTotal(json.total);
      setNameById((prev) => {
        const next = { ...prev };
        for (const e of json.employees) next[e.id] = displayName(e);
        return next;
      });
    } catch (err) {
      if (seq !== reqRef.current) return;
      setError(err.message);
      setRows([]);
    }
  }, [page, debouncedQ, account, stage, includeExited, stageKey]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const stageCounts = useMemo(() => {
    const c = {};
    for (const r of rows || []) c[r.stage] = (c[r.stage] || 0) + 1;
    return c;
  }, [rows]);

  if (admitting) {
    return (
      <AdmitPerson
        accounts={accounts}
        onCancel={() => setAdmitting(false)}
        onDone={(created) => {
          setAdmitting(false);
          load();
          // Straight into the new record, where the lifecycle buttons live.
          setOpenId(created.id);
        }}
      />
    );
  }

  if (openId) {
    return (
      <EmployeeProfile
        employeeId={openId}
        onBack={() => setOpenId(null)}
        onChanged={load}
        nameById={nameById}
      />
    );
  }

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Users size={14} />
          {heading}
        </span>
      }
      right={
        <div className="flex items-center gap-2">
          {rows && (
            <span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>
              {plural(total, "person", "people")}
            </span>
          )}
          {can(me, "employeeWrite") && (
            <BtnGhost onClick={() => setAdmitting(true)} icon={UserPlus}>
              Admit someone
            </BtnGhost>
          )}
          <BtnGhost onClick={load} icon={RefreshCw}>
            Refresh
          </BtnGhost>
        </div>
      }
    >
      {blurb && (
        <div className="mb-3" style={{ fontSize: 12, color: P.sub }}>{blurb}</div>
      )}

      {/* ── Filters ── */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div
          className="flex items-center gap-2"
          style={{ border: `1px solid ${P.line}`, background: "var(--well)", borderRadius: 999, padding: "5px 12px", width: 260 }}
        >
          <Search size={13} color={P.sub} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, employee id, email, title…"
            aria-label="Search people"
            style={{ border: "none", background: "transparent", outline: "none", fontSize: 12.5, color: P.ink, flex: 1, minWidth: 0 }}
          />
        </div>

        <select
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          aria-label="Filter by account"
          style={{
            fontSize: 12, padding: "5px 10px", borderRadius: 999, cursor: "pointer",
            border: `1px solid ${P.line}`, background: P.card, color: P.inkSoft,
          }}
        >
          <option value="All">All accounts</option>
          {accounts.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <button
          onClick={() => setStage("All")}
          className="ao-disp uppercase tracking-wide font-semibold"
          style={{
            fontSize: 11, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
            border: `1px solid ${stage === "All" ? P.petrol : P.line}`,
            color: stage === "All" ? "#fff" : P.sub,
            background: stage === "All" ? P.petrol : "transparent",
          }}
        >
          All
        </button>
        {(stages ?? STAGES.filter((s) => s !== "Exited")).map((s) => {
          const meta = STAGE_STYLE[s];
          const on = stage === s;
          return (
            <button
              key={s}
              onClick={() => setStage(on ? "All" : s)}
              className="ao-disp uppercase tracking-wide font-semibold"
              style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${on ? meta.color : P.line}`,
                color: on ? "var(--chip-on-text)" : meta.color,
                background: on ? meta.color : "transparent",
              }}
            >
              {meta.label}
              {stageCounts[s] ? ` ${stageCounts[s]}` : ""}
            </button>
          );
        })}

        <label
          className="inline-flex items-center gap-1.5"
          style={{ fontSize: 11.5, color: P.sub, cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={includeExited}
            onChange={(e) => setIncludeExited(e.target.checked)}
          />
          Include leavers
        </label>
      </div>

      {error && (
        <div style={{ fontSize: 13, color: P.brick }} role="alert">
          {error}
        </div>
      )}

      {rows === null && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}
          aria-busy="true"
          aria-label="Loading the directory"
        >
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 14, padding: 14, display: "grid", gap: 10 }}>
              <div className="flex items-start gap-3">
                <div className="ao-skeleton" style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0 }} />
                <div className="flex-1 grid gap-1.5">
                  <div className="ao-skeleton" style={{ height: 11, width: `${52 + ((i * 11) % 24)}%` }} />
                  <div className="ao-skeleton" style={{ height: 9, width: "38%" }} />
                </div>
              </div>
              <div className="ao-skeleton" style={{ height: 10, width: "64%" }} />
              <div className="ao-skeleton" style={{ height: 9, width: "80%" }} />
            </div>
          ))}
        </div>
      )}

      {rows !== null && !error && rows.length === 0 && (
        <Muted>
          {debouncedQ || account !== "All" || stage !== "All"
            ? "Nobody matches those filters."
            : "No employee records yet."}
        </Muted>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="grid gap-3 ao-stagger" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
          {rows.map((e) => (
            <PersonCard
              key={e.id}
              employee={e}
              managerName={e.directManagerId ? nameById[e.directManagerId] : ""}
              onOpen={setOpenId}
            />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <BtnGhost onClick={() => setPage((p) => Math.max(1, p - 1))} icon={ChevronLeft} disabled={page <= 1}>
            Previous
          </BtnGhost>
          <span className="ao-mono" style={{ fontSize: 11.5, color: P.sub }}>
            Page {page} of {pages}
          </span>
          <BtnGhost onClick={() => setPage((p) => Math.min(pages, p + 1))} icon={ChevronRight} disabled={page >= pages}>
            Next
          </BtnGhost>
        </div>
      )}
    </Card>
  );
}

export { Avatar, StageChip, STAGE_STYLE, initialsOf, tintFor };

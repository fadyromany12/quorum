"use client";

/* The floor — who is on shift right now and what they are doing.

   A wall-display screen as much as a page: a supervisor leaves it open and
   glances at it, so it has to answer "is anything wrong?" without being read.
   Everything follows from that:

     · Ordered by what needs attention, not alphabetically. The API sorts
       breaches first, then whoever has been in one state longest.
     · Elapsed times tick locally against server time. Polling every second for
       a number the browser can count itself would put 200 agents' worth of
       queries behind a clock.
     · Anything over its limit is loud. Everything else stays quiet — a screen
       where every tile competes for attention conveys nothing. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MonitorPlay, RefreshCw, TriangleAlert, Coffee, UtensilsCrossed, Users,
  GraduationCap, Headphones, PauseCircle, Wrench, ClipboardList, LogOut,
} from "lucide-react";
import { Card, Pill, Muted, BtnGhost } from "./ui/index.jsx";
import { useLabels } from "../hooks/useLocale.jsx";
import { P } from "../lib/tokens.js";
import { plural } from "../lib/format.js";
import { AUX_CODES } from "../lib/attendance.js";
import { displayName } from "../lib/employee.js";

const AUX_META = {
  Available: { icon: Headphones, color: P.green },
  BackOffice: { icon: ClipboardList, color: P.green },
  Break: { icon: Coffee, color: P.amber },
  Lunch: { icon: UtensilsCrossed, color: P.amber },
  Meeting: { icon: Users, color: P.petrol },
  Training: { icon: GraduationCap, color: P.petrol },
  Coaching: { icon: ClipboardList, color: P.petrol },
  Idle: { icon: PauseCircle, color: P.sub },
  Technical: { icon: Wrench, color: P.brick },
};

const REFRESH_MS = 15_000;

const mmss = (s) => {
  const n = Math.max(0, Math.floor(s));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

function AgentTile({ agent, serverNow }) {
  const { labelFor } = useLabels();
  const s = agent.state || {};
  const meta = AUX_META[s.aux] || { icon: Headphones, color: P.sub };
  const Icon = s.loggedIn ? meta.icon : LogOut;
  const elapsed = s.since ? Math.max(0, Math.floor((serverNow - s.since) / 1000)) : 0;
  const limit = AUX_CODES[s.aux]?.limitSeconds;
  const over = s.loggedIn && limit && elapsed > limit;
  const tone = !s.loggedIn ? P.sub : over ? P.brick : meta.color;

  return (
    <div
      style={{
        background: over ? P.brickWash : P.card,
        border: `1px solid ${over ? P.brick : P.line}`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: 12,
        padding: 12,
        display: "grid",
        gap: 7,
      }}
    >
      <div className="flex items-center gap-2">
        <Icon size={14} color={tone} style={{ flexShrink: 0 }} />
        <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13, fontWeight: 600, color: P.ink }}>
          {displayName(agent)}
        </span>
        {over && <TriangleAlert size={13} color={P.brick} style={{ flexShrink: 0 }} />}
      </div>

      <div className="flex items-baseline gap-2">
        <span style={{ fontSize: 12.5, color: tone, fontWeight: 500 }}>
          {s.loggedIn ? labelFor(AUX_CODES, s.aux) : "Logged out"}
        </span>
        {s.loggedIn && (
          <span className="ao-mono" style={{ fontSize: 12, color: over ? P.brick : P.sub }}>
            {mmss(elapsed)}
            {limit ? ` / ${Math.round(limit / 60)}m` : ""}
          </span>
        )}
      </div>

      <div className="ao-mono flex items-center gap-2" style={{ fontSize: 10.5, color: P.sub }}>
        <span>{agent.empId}</span>
        {agent.account && <span>· {agent.account}</span>}
        {agent.summary?.occupancyPct > 0 && <span>· {agent.summary.occupancyPct}%</span>}
      </div>

      {agent.breaches?.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {agent.breaches.slice(0, 2).map((b, i) => (
            <Pill key={i} color={P.brick}>
              {b.kind === "over_limit"
                ? `${labelFor(AUX_CODES, b.aux)} +${Math.round(b.overBy / 60)}m`
                : `${b.count}× ${labelFor(AUX_CODES, b.aux)}`}
            </Pill>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FloorView({ accounts = [] }) {
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [account, setAccount] = useState("All");
  const [, setTick] = useState(0);

  /* Server time is authoritative for every elapsed figure; the browser only
     counts forward from it. A supervisor whose machine is fast must not see
     agents as further into their breaks than they are. */
  const skewRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const qs = account !== "All" ? `?account=${encodeURIComponent(account)}` : "";
      const res = await fetch(`/api/attendance/floor${qs}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load the floor.");
      skewRef.current = Date.now() - json.now;
      setData(json);
      setError("");
    } catch (err) {
      setError(err.message);
      setData((d) => d ?? { agents: [] });
    }
  }, [account]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    const r = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [load]);

  const serverNow = Date.now() - skewRef.current;
  const agents = data?.agents || [];
  const inCount = agents.filter((a) => a.state?.loggedIn).length;
  const breachCount = agents.filter((a) => a.breaches?.length).length;
  const byState = agents.reduce((acc, a) => {
    if (!a.state?.loggedIn) return acc;
    acc[a.state.aux] = (acc[a.state.aux] || 0) + 1;
    return acc;
  }, {});

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <MonitorPlay size={14} />
          Floor — live
        </span>
      }
      right={
        <div className="flex items-center gap-2">
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
          <BtnGhost onClick={load} icon={RefreshCw}>Refresh</BtnGhost>
        </div>
      }
    >
      {error && (
        <div className="mb-3" role="alert" style={{ fontSize: 13, color: P.brick }}>{error}</div>
      )}

      {/* ── Summary strip: the whole point of the screen, readable at a glance ── */}
      {data && (
        <div className="flex items-center gap-3 flex-wrap mb-3 pb-3" style={{ borderBottom: `1px solid ${P.line}` }}>
          <span className="ao-disp" style={{ fontSize: 19, fontWeight: 650, color: P.ink }}>
            {inCount}
            <span style={{ fontSize: 12, color: P.sub, fontWeight: 400 }}> / {agents.length} on shift</span>
          </span>
          {breachCount > 0 && (
            <Pill color={P.brick}>
              {plural(breachCount, "agent")} over a limit
            </Pill>
          )}
          <span className="flex-1" />
          {Object.entries(byState)
            .sort((a, b) => b[1] - a[1])
            .map(([aux, n]) => (
              <Pill key={aux} color={(AUX_META[aux] || {}).color || P.sub}>
                {AUX_CODES[aux]?.label || aux} {n}
              </Pill>
            ))}
        </div>
      )}

      {data === null && (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }} aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 12, padding: 12, display: "grid", gap: 7 }}>
              <div className="ao-skeleton" style={{ height: 12, width: `${55 + ((i * 9) % 25)}%` }} />
              <div className="ao-skeleton" style={{ height: 11, width: "42%" }} />
              <div className="ao-skeleton" style={{ height: 9, width: "62%" }} />
            </div>
          ))}
        </div>
      )}

      {data !== null && agents.length === 0 && !error && (
        <Muted>Nobody in a working stage matches this filter.</Muted>
      )}

      {agents.length > 0 && (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
          {agents.map((a) => (
            <AgentTile key={a.id} agent={a} serverNow={serverNow} />
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: P.sub, marginTop: 12 }}>
        Refreshes every {REFRESH_MS / 1000} seconds. Timers run against server time, so a fast
        or slow local clock cannot shift what you see here.
      </div>
    </Card>
  );
}

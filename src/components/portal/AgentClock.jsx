"use client";

/* The agent clock.

   The screen an agent has open all day, so it is built for one thing: showing
   the current state unambiguously and changing it in one tap. Design choices
   follow from that —

     · The elapsed timer ticks locally against a server-supplied instant, so it
       stays smooth without polling every second. Server time is authoritative;
       the client only counts forward from it.
     · Clock skew is measured once on load and subtracted, so an agent whose
       laptop is ten minutes fast does not see a ten-minute break as twenty.
     · Buttons disable while a punch is in flight. A double-tap is handled
       server-side as a duplicate, but disabling removes the doubt.
     · Over-limit breaks are surfaced immediately and in words, because the point
       is to get the agent back, not to catch them. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LogIn, LogOut, Coffee, UtensilsCrossed, Users, GraduationCap, Headphones,
  PauseCircle, Wrench, ClipboardList, TriangleAlert, Clock,
} from "lucide-react";
import { Card, Pill, Muted } from "../ui/index.jsx";
import { P } from "../../lib/tokens.js";
import { AUX_CODES } from "../../lib/attendance.js";

/* Icons per state. Ordered as an agent reaches for them: the two they use every
   shift first, the rest after. */
const AUX_META = {
  Available: { icon: Headphones, color: P.green },
  Break: { icon: Coffee, color: P.amber },
  Lunch: { icon: UtensilsCrossed, color: P.amber },
  Meeting: { icon: Users, color: P.petrol },
  Training: { icon: GraduationCap, color: P.petrol },
  Coaching: { icon: ClipboardList, color: P.petrol },
  BackOffice: { icon: ClipboardList, color: P.green },
  Idle: { icon: PauseCircle, color: P.sub },
  Technical: { icon: Wrench, color: P.brick },
};
const AUX_ORDER = ["Available", "Break", "Lunch", "Meeting", "Coaching", "Training", "BackOffice", "Technical", "Idle"];

const hhmmss = (s) => {
  const n = Math.max(0, Math.floor(s));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};
/* Durations inside a sentence get words. "7:00 over your limit" reads as seven
   hours; "7 min" cannot be misread. The clock face keeps m:ss. */
const words = (s) => {
  const n = Math.max(0, Math.round(s / 60));
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

const hm = (s) => {
  const n = Math.max(0, Math.floor(s));
  return `${Math.floor(n / 3600)}h ${String(Math.floor((n % 3600) / 60)).padStart(2, "0")}m`;
};

export default function AgentClock() {
  const [day, setDay] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  /* Difference between this browser's clock and the server's, measured on load.
     Every elapsed figure is computed against server time so a wrong local clock
     cannot distort what the agent (or their supervisor) sees. */
  const skewRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance/me");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load your clock.");
      skewRef.current = Date.now() - json.now;
      setDay(json);
      setError("");
    } catch (err) {
      setError(err.message);
      setDay((d) => d ?? { state: { loggedIn: false }, summary: null, breaches: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Local 1s tick for the timer; a full refetch every 60s to stay in step with
  // anything a supervisor did on the agent's behalf.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    const r = setInterval(load, 60_000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [load]);

  const send = async (body) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/attendance/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "That did not go through.");
      skewRef.current = Date.now() - json.now;
      setDay(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (day === null) {
    return (
      <Card title="Clock">
        <div className="grid gap-3" aria-busy="true">
          <div className="ao-skeleton" style={{ height: 84, borderRadius: 14 }} />
          <div className="ao-skeleton" style={{ height: 120, borderRadius: 14 }} />
        </div>
      </Card>
    );
  }

  const state = day.state || { loggedIn: false };
  const serverNow = Date.now() - skewRef.current;
  const inStateSeconds = state.since ? Math.max(0, Math.floor((serverNow - state.since) / 1000)) : 0;
  const sessionSeconds = state.sessionStart ? Math.max(0, Math.floor((serverNow - state.sessionStart) / 1000)) : 0;
  const meta = AUX_META[state.aux] || { icon: Headphones, color: P.sub };
  const StateIcon = meta.icon;
  const limit = AUX_CODES[state.aux]?.limitSeconds;
  const over = limit && inStateSeconds > limit;

  return (
    <div className="grid gap-3">
      {error && (
        <div role="alert" style={{ background: P.brickWash, border: `1px solid ${P.brick}`, borderRadius: 12, padding: "10px 13px", fontSize: 13, color: P.brick }}>
          {error}
        </div>
      )}

      {/* ── Current state ── */}
      <Card title={<span className="inline-flex items-center gap-2"><Clock size={14} />Clock</span>}>
        <div
          className="flex items-center gap-4 flex-wrap"
          style={{
            background: state.loggedIn
              ? `color-mix(in srgb, ${over ? P.brick : meta.color} 10%, transparent)`
              : "var(--well)",
            border: `1px solid ${state.loggedIn ? `color-mix(in srgb, ${over ? P.brick : meta.color} 34%, transparent)` : P.line}`,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div
            className="grid place-items-center flex-shrink-0"
            style={{
              width: 52, height: 52, borderRadius: 14,
              background: state.loggedIn ? `color-mix(in srgb, ${over ? P.brick : meta.color} 18%, transparent)` : P.mist,
            }}
          >
            {state.loggedIn ? <StateIcon size={24} color={over ? P.brick : meta.color} /> : <LogOut size={22} color={P.sub} />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="ao-disp uppercase tracking-wide" style={{ fontSize: 10.5, color: P.sub, letterSpacing: 0.7 }}>
              {state.loggedIn ? "Current state" : "Not logged in"}
            </div>
            <div className="ao-disp" style={{ fontSize: 21, fontWeight: 650, color: over ? P.brick : P.ink, lineHeight: 1.2 }}>
              {state.loggedIn ? AUX_CODES[state.aux]?.label || state.aux : "Logged out"}
            </div>
            {state.loggedIn && (
              <div className="ao-mono" style={{ fontSize: 12.5, color: over ? P.brick : P.sub, marginTop: 2 }}>
                {hhmmss(inStateSeconds)}
                {limit ? ` of ${Math.round(limit / 60)}m` : ""}
                {" · "}
                shift {hm(sessionSeconds)}
              </div>
            )}
          </div>

          {/* One primary action, always in the same place. */}
          {state.loggedIn ? (
            <button
              type="button"
              onClick={() => send({ type: "LOGOUT" })}
              disabled={busy}
              className="ao-glow ao-disp uppercase tracking-wide font-semibold"
              style={{
                fontSize: 12, padding: "11px 20px", borderRadius: 12, cursor: busy ? "wait" : "pointer",
                border: `1px solid ${P.brick}`, background: P.brickWash, color: P.brick, opacity: busy ? 0.6 : 1,
              }}
            >
              <span className="inline-flex items-center gap-2"><LogOut size={14} />Log out</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => send({ type: "LOGIN" })}
              disabled={busy}
              className="ao-glow ao-disp uppercase tracking-wide font-semibold"
              style={{
                fontSize: 12.5, padding: "13px 26px", borderRadius: 12, cursor: busy ? "wait" : "pointer",
                border: "none", background: P.petrol, color: "#fff", opacity: busy ? 0.6 : 1,
              }}
            >
              <span className="inline-flex items-center gap-2"><LogIn size={15} />Log in</span>
            </button>
          )}
        </div>

        {over && (
          <div
            className="flex items-center gap-2 mt-3"
            role="alert"
            style={{ background: P.brickWash, border: `1px solid ${P.brick}`, borderRadius: 10, padding: "9px 12px", fontSize: 12.5, color: P.brick }}
          >
            <TriangleAlert size={13} />
            You are {words(inStateSeconds - limit)} over your {Math.round(limit / 60)}-minute {AUX_CODES[state.aux]?.label.toLowerCase()}.
          </div>
        )}

        {/* ── State selector ── */}
        {state.loggedIn && (
          <div className="mt-4">
            <div className="ao-disp uppercase tracking-wide mb-2" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>
              Change state
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))" }}>
              {AUX_ORDER.filter((a) => AUX_CODES[a]).map((a) => {
                const m = AUX_META[a] || { icon: Headphones, color: P.sub };
                const Icon = m.icon;
                const on = state.aux === a;
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => send({ type: "AUX", aux: a })}
                    disabled={busy || on}
                    className={on ? "" : "ao-lift"}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "11px 13px", borderRadius: 12, fontSize: 12.5, textAlign: "left",
                      border: `1px solid ${on ? m.color : P.line}`,
                      background: on ? `color-mix(in srgb, ${m.color} 14%, transparent)` : P.card,
                      color: on ? m.color : P.inkSoft,
                      fontWeight: on ? 600 : 500,
                      cursor: on ? "default" : busy ? "wait" : "pointer",
                      opacity: busy && !on ? 0.6 : 1,
                    }}
                    aria-pressed={on}
                  >
                    <Icon size={14} color={on ? m.color : P.sub} style={{ flexShrink: 0 }} />
                    <span className="min-w-0 truncate">{AUX_CODES[a].label}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: P.sub, marginTop: 8 }}>
              {AUX_CODES.Lunch.label} is unpaid. Break is {Math.round(AUX_CODES.Break.limitSeconds / 60)} minutes,{" "}
              {AUX_CODES.Break.maxPerShift} per shift.
            </div>
          </div>
        )}
      </Card>

      {/* ── Today ── */}
      {day.summary && (
        <Card
          title="Today"
          right={<span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>{day.today}</span>}
        >
          {day.summary.loggedInSeconds === 0 ? (
            <Muted>Nothing logged today yet.</Muted>
          ) : (
            <>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
                {[
                  ["Logged in", hm(day.summary.loggedInSeconds), P.ink],
                  ["Paid", hm(day.summary.paidSeconds), P.green],
                  ["Productive", hm(day.summary.productiveSeconds), P.petrol],
                  ["Occupancy", `${day.summary.occupancyPct}%`, P.petrol],
                ].map(([label, value, color]) => (
                  <div key={label}>
                    <div className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>
                      {label}
                    </div>
                    <div className="ao-mono" style={{ fontSize: 17, color, fontWeight: 600 }}>{value}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 flex-wrap mt-3 pt-3" style={{ borderTop: `1px solid ${P.line}` }}>
                {Object.entries(day.summary.byAux).map(([a, secs]) => (
                  <Pill key={a} color={(AUX_META[a] || {}).color || P.sub}>
                    {AUX_CODES[a]?.label || a} {hm(secs)}
                  </Pill>
                ))}
              </div>

              {day.breaches?.length > 0 && (
                <div className="grid gap-1.5 mt-3">
                  {day.breaches.map((b, i) => (
                    <div
                      key={i}
                      style={{ background: P.amberWash, border: `1px solid ${P.amber}`, borderRadius: 10, padding: "8px 11px", fontSize: 12, color: P.amber }}
                    >
                      {b.kind === "over_limit"
                        ? `${AUX_CODES[b.aux]?.label || b.aux} ran ${words(b.overBy)} over its ${Math.round(b.limitSeconds / 60)}-minute limit${b.open ? " (still running)" : ""}.`
                        : `${b.count} ${AUX_CODES[b.aux]?.label?.toLowerCase() || b.aux} periods — the limit is ${b.maxPerShift} per shift.`}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}

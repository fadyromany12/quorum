"use client";

/* The planning screen: what the queue needs, what the roster covers, and the
   gap between them.

   The design decision that shapes everything else is the coverage strip. A
   staffing plan is fundamentally a shape over the day — a morning peak, a
   lunchtime dip, an evening tail — and a table of forty-eight rows hides that
   shape completely. A planner reading a table finds the shortfall by scanning;
   a planner reading a strip sees it before they have finished sitting down.

   Numbers are still there underneath, because a shape nobody can check is
   decoration. Every interval is hoverable and the working for the busiest one
   is printed in full, so the answer to "why 34?" is on the screen rather than
   in someone's head. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Gauge, TriangleAlert, CircleCheck, Info, Upload, RefreshCw, Users } from "lucide-react";

import { P, alpha } from "../lib/tokens.js";
import { todayStr } from "../lib/dates.js";
import { SectionTitle, Muted, BtnGhost, BtnPrimary, TInput, TSelect, Label, Field } from "./ui/index.jsx";
import Intraday from "./Intraday.jsx";
import Tip from "./ui/Tip.jsx";
import { lobsFor } from "../lib/org.js";
import RosterEditor from "./RosterEditor.jsx";
import { DEFAULT_INTERVAL } from "../lib/wfm.js";

const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
const one = (x) => (Math.round((x ?? 0) * 10) / 10).toString();

/* Deliberately three states rather than a gradient. "Two short" and "eleven
   short" both mean the queue is unmanned and both need the same action; a
   twenty-step colour ramp invites a planner to treat a small shortfall as
   nearly fine, which is how the small ones never get fixed. */
const toneFor = (row) => {
  if (!row) return P.line;
  if (row.state === "under") return P.brick;
  if (row.state === "over" && row.difference > row.required * 0.25) return P.amber;
  return P.green;
};

export default function WfmPlanner({ me, accounts = [], canWrite, canRoster }) {
  const [account, setAccount] = useState(accounts[0] ?? "");
  const [lob, setLob] = useState("");
  const [date, setDate] = useState(todayStr());
  const [target, setTarget] = useState(0.8);
  const [answerIn, setAnswerIn] = useState(20);
  const [maxOcc, setMaxOcc] = useState(0.85);

  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paste, setPaste] = useState("");
  const [showImport, setShowImport] = useState(false);
  /* Two views over the same day rather than two screens. Building the roster
     and judging it are the same task ten seconds apart, and making them
     separate places means carrying the account, line and date across both and
     hoping they still agree. */
  const [view, setView] = useState("plan");

  const lobs = useMemo(() => lobsFor(accounts, account), [accounts, account]);

  const load = useCallback(async () => {
    if (!account) return;
    setBusy(true);
    setError("");
    try {
      const q = new URLSearchParams({
        account, lob, date,
        targetServiceLevel: String(target),
        targetSeconds: String(answerIn),
        maxOccupancy: String(maxOcc),
        interval: String(DEFAULT_INTERVAL),
      });
      const r = await fetch(`/api/wfm/plan?${q}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load the plan.");
      setData(j);
    } catch (e) {
      setError(e.message);
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [account, lob, date, target, answerIn, maxOcc]);

  useEffect(() => { load(); }, [load]);
  // A line of business that does not exist on the newly chosen account would
  // silently filter everything out.
  useEffect(() => { if (lob && !lobs.includes(lob)) setLob(""); }, [lobs, lob]);

  /* Accepts what a planner actually has: three columns out of a spreadsheet,
     tab- or comma-separated, with or without a header row. Anything it cannot
     read is reported by the API rather than guessed at here. */
  const importForecast = async () => {
    setBusy(true);
    setError("");
    try {
      const rows = paste
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.split(/[\t,;]+/).map((c) => c.trim()))
        .filter((c) => c.length >= 3 && /^\d{1,2}:\d{2}$/.test(c[0]))
        .map(([interval, contacts, aht]) => ({
          interval: interval.padStart(5, "0"),
          contacts: Number(contacts),
          ahtSeconds: Number(aht),
        }));
      if (rows.length === 0) throw new Error("No rows read. Each line needs a time, a volume and a handling time in seconds.");

      const r = await fetch("/api/wfm/forecast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account, lob, date, rows, source: "client" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "The forecast was refused.");
      setPaste("");
      setShowImport(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cov = data?.coverage;
  const rows = cov?.rows ?? [];
  const peak = useMemo(
    () => (data?.plan ?? []).reduce((a, b) => (a === null || b.rostered > a.rostered ? b : a), null),
    [data]
  );

  return (
    <div className="grid gap-5">
      <div>
        <SectionTitle count={rows.length} tone={P.petrol}>Planning</SectionTitle>
        <Muted>
          What the queue needs, interval by interval, and whether the roster covers it. Every number below is recomputed
          from the forecast on each load — nothing here is a stored figure that can drift from its inputs.
        </Muted>
      </div>

      {/* ── Controls ── */}
      <div className="p-4" style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 12 }}>
        <div className="grid gap-3 md:grid-cols-6">
          <Field label="Account">
            <TSelect value={account} onChange={(e) => setAccount(e.target.value)}>
              {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
            </TSelect>
          </Field>
          <Field label="Line of business">
            <TSelect value={lob} onChange={(e) => setLob(e.target.value)} disabled={lobs.length === 0}>
              <option value="">{lobs.length ? "All lines" : "None defined"}</option>
              {lobs.map((l) => <option key={l} value={l}>{l}</option>)}
            </TSelect>
          </Field>
          <Field label="Day">
            <TInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Answer target">
            <TSelect value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              <option value={0.7}>70%</option>
              <option value={0.8}>80%</option>
              <option value={0.9}>90%</option>
              <option value={0.95}>95%</option>
            </TSelect>
          </Field>
          <Field label="Within">
            <TSelect value={answerIn} onChange={(e) => setAnswerIn(Number(e.target.value))}>
              {[10, 15, 20, 30, 45, 60].map((s) => <option key={s} value={s}>{s}s</option>)}
            </TSelect>
          </Field>
          <Field label="Occupancy cap">
            <TSelect value={maxOcc} onChange={(e) => setMaxOcc(Number(e.target.value))}>
              <option value={0.8}>80%</option>
              <option value={0.85}>85%</option>
              <option value={0.9}>90%</option>
              <option value={1}>No cap</option>
            </TSelect>
          </Field>
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <div className="inline-flex" style={{ border: `1px solid ${P.line}`, borderRadius: 8, overflow: "hidden" }}>
            {[["plan", "Plan", Gauge], ["roster", "Roster", Users]].map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className="ao-disp uppercase tracking-wide font-semibold inline-flex items-center gap-1.5 transition"
                style={{
                  fontSize: 11.5, padding: "8px 14px", border: "none", cursor: "pointer",
                  background: view === id ? P.petrol : "transparent",
                  color: view === id ? "#fff" : P.sub,
                }}
              >
                <Icon size={12} />{label}
              </button>
            ))}
          </div>
          <Tip label="Recompute from the stored forecast and the current roster">
            <BtnGhost icon={RefreshCw} onClick={load} disabled={busy}>Refresh</BtnGhost>
          </Tip>
          {canWrite && view === "plan" && (
            <BtnGhost icon={Upload} onClick={() => setShowImport((v) => !v)}>
              {showImport ? "Cancel import" : "Load a forecast"}
            </BtnGhost>
          )}
          <span className="flex-1" />
          <Muted>Changing a target here changes nothing stored — it re-asks the question.</Muted>
        </div>

        {showImport && view === "plan" && (
          <div className="mt-3 ao-rise">
            <Label>Paste three columns: time, contacts, handling time in seconds</Label>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"09:00\t420\t260\n09:30\t480\t255\n10:00\t510\t250"}
              spellCheck={false}
              style={{
                width: "100%", minHeight: 130, marginTop: 6, padding: 10, borderRadius: 8,
                border: `1px solid ${P.line}`, background: "var(--well)", color: P.ink,
                fontFamily: "var(--font-mono, monospace)", fontSize: 12.5,
              }}
            />
            <div className="flex items-center gap-2 mt-2">
              <BtnPrimary onClick={importForecast} disabled={busy || !paste.trim()}>Import</BtnPrimary>
              <Muted>
                Re-importing the same day corrects it in place. Pasting twice cannot double the volume.
              </Muted>
            </div>
          </div>
        )}
      </div>

      {view === "roster" && canRoster && (
        <RosterEditor account={account} lob={lob} date={date} onSaved={load} />
      )}
      {view === "roster" && !canRoster && (
        <Muted>Your role can read the plan but not change the roster — WFM and Operations Leads build it.</Muted>
      )}

      {view === "plan" && error && (
        <div className="flex items-start gap-2 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8 }} role="alert">
          <TriangleAlert size={15} color={P.brick} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, color: P.inkSoft }}>{error}</span>
        </div>
      )}

      {view === "plan" && data?.problems?.length > 0 && (
        <div className="p-3" style={{ background: P.amberWash, border: `1px solid ${alpha(P.amber, 0.4)}`, borderRadius: 8 }}>
          <div className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 10.5, color: P.amber }}>
            The forecast cannot be planned from
          </div>
          <ul style={{ margin: "6px 0 0", paddingInlineStart: 18, fontSize: 12.5, color: P.inkSoft }}>
            {data.problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      )}

      {view === "plan" && data && data.forecast.length === 0 && !data.problems.length && (
        <div className="p-6 text-center" style={{ background: P.card, border: `1px dashed ${P.line}`, borderRadius: 12 }}>
          <CalendarDays size={22} color={P.sub} />
          <div className="ao-disp font-semibold mt-2" style={{ fontSize: 14 }}>No forecast for this day</div>
          <Muted>
            {canWrite
              ? "Load one above and the requirement, coverage and shrinkage all follow from it."
              : "Ask WFM to load one — the requirement is derived from it, so there is nothing to show until it exists."}
          </Muted>
        </div>
      )}

      {view === "plan" && rows.length > 0 && (
        <>
          {/* ── Headline ── */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat
              label="Peak requirement"
              value={peak ? `${peak.rostered}` : "—"}
              hint={peak ? `Rostered heads needed at ${peak.interval}, the busiest interval` : ""}
              tone={P.petrol}
            />
            <Stat
              label="Shrinkage"
              value={pct(data.settings.shrinkage)}
              hint={`Measured from this day's own roster: ${one(data.shrinkageDerived.lostHours)}h lost of ${one(data.shrinkageDerived.paidHours)}h paid`}
              tone={data.settings.shrinkage > 0.35 ? P.amber : P.sub}
            />
            <Stat
              label="Intervals short"
              value={cov.understaffedIntervals}
              hint={cov.worstUnder ? `Worst is ${cov.worstUnder.interval}, ${-cov.worstUnder.difference} under` : "Every interval is covered"}
              tone={cov.understaffedIntervals ? P.brick : P.green}
            />
            <Stat
              label="Agent-intervals short"
              value={one(cov.agentHoursShort)}
              hint="Summed shortfall. Never netted against the surplus — a morning gap and an afternoon surplus are two problems"
              tone={cov.agentHoursShort ? P.brick : P.green}
            />
            <Stat
              label="Spare"
              value={one(cov.agentHoursSpare)}
              hint="Summed surplus, for the intervals that are over-covered"
              tone={P.sub}
            />
          </div>

          {/* Required against rostered against actually-here. Above the
              coverage strip because it answers the more urgent question: the
              strip says whether the plan is sound, this says whether today is
              holding. */}
          <Intraday
            rows={data.intraday ?? []}
            summary={data.intradaySummary}
            live={!!data.live}
            nowInterval={data.nowInterval}
          />

          {/* ── The strip ── */}
          <div className="p-4" style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 12 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
              <Gauge size={14} color={P.petrol} />
              <span className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 10.5, letterSpacing: 0.9, color: P.sub }}>
                Coverage through the day
              </span>
              <span className="flex-1" />
              <Legend tone={P.green} label="Covered" />
              <Legend tone={P.amber} label="Over" />
              <Legend tone={P.brick} label="Short" />
            </div>

            <div className="flex items-end gap-[2px]" style={{ height: 132 }}>
              {rows.map((r, i) => {
                const max = Math.max(...rows.map((x) => Math.max(x.required, x.scheduled)), 1);
                const tone = toneFor(r);
                return (
                  <Tip
                    key={r.interval}
                    label={`${r.interval} — ${r.required} needed, ${one(r.scheduled)} rostered (${r.difference >= 0 ? "+" : ""}${one(r.difference)})`}
                    fill
                  >
                    <div
                      className="ao-reveal is-in"
                      style={{ position: "relative", height: 132, display: "flex", alignItems: "flex-end", "--i": i }}
                    >
                      {/* Required, as the outline the roster has to fill */}
                      <div
                        style={{
                          position: "absolute", left: 0, right: 0, bottom: 0,
                          height: `${(r.required / max) * 100}%`,
                          border: `1px solid ${alpha(P.ink, 0.28)}`,
                          borderRadius: 2,
                          background: alpha(P.ink, 0.05),
                        }}
                      />
                      {/* Scheduled, as the fill */}
                      <div
                        style={{
                          position: "relative", width: "100%",
                          height: `${(r.scheduled / max) * 100}%`,
                          background: alpha(tone, 0.75),
                          borderRadius: 2,
                          transition: "height var(--dur-slow) var(--ease-enter)",
                        }}
                      />
                    </div>
                  </Tip>
                );
              })}
            </div>
            <div className="flex justify-between" style={{ marginTop: 6 }}>
              {[0, Math.floor(rows.length / 2), rows.length - 1].map((i) => (
                <span key={i} className="ao-mono" style={{ fontSize: 10, color: P.sub }}>{rows[i]?.interval}</span>
              ))}
            </div>
          </div>

          {/* ── The working ── */}
          {data.explanation?.length > 0 && (
            <div className="p-4" style={{ background: "var(--mist)", borderRadius: 12 }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                <Info size={13} color={P.petrol} />
                <span className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 10.5, letterSpacing: 0.9, color: P.sub }}>
                  Why the busiest interval asks for what it does
                </span>
              </div>
              <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 13, color: P.inkSoft, lineHeight: 1.7 }}>
                {data.explanation.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </div>
          )}

          {/* ── The numbers ── */}
          <div style={{ overflowX: "auto", border: `1px solid ${P.line}`, borderRadius: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 620 }}>
              <thead>
                <tr style={{ background: "var(--mist)" }}>
                  {["Interval", "Contacts", "Load", "On queue", "Rostered", "Scheduled", "Gap", "Service"].map((h) => (
                    <th key={h} className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, padding: "8px 10px", textAlign: h === "Interval" ? "start" : "end" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.plan.map((p) => {
                  const c = rows.find((r) => r.interval === p.interval);
                  return (
                    <tr key={p.interval} className="ao-row" style={{ borderTop: `1px solid ${P.line}` }}>
                      <td className="ao-mono" style={{ padding: "7px 10px", color: P.ink }}>{p.interval}</td>
                      <td className="ao-mono" style={{ padding: "7px 10px", textAlign: "end", color: P.inkSoft }}>{p.contacts}</td>
                      <td className="ao-mono" style={{ padding: "7px 10px", textAlign: "end", color: P.sub }}>{one(p.load)}</td>
                      <td className="ao-mono" style={{ padding: "7px 10px", textAlign: "end", color: P.inkSoft }}>{p.onPhone}</td>
                      <td className="ao-mono font-semibold" style={{ padding: "7px 10px", textAlign: "end", color: P.ink }}>{p.rostered}</td>
                      <td className="ao-mono" style={{ padding: "7px 10px", textAlign: "end", color: P.inkSoft }}>{one(c?.scheduled ?? 0)}</td>
                      <td className="ao-mono font-semibold" style={{ padding: "7px 10px", textAlign: "end", color: toneFor(c) }}>
                        {c ? `${c.difference >= 0 ? "+" : ""}${one(c.difference)}` : "—"}
                      </td>
                      <td className="ao-mono" style={{ padding: "7px 10px", textAlign: "end", color: p.serviceLevel >= target ? P.green : P.amber }}>
                        {pct(p.serviceLevel)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {cov.covered ? (
              <>
                <CircleCheck size={14} color={P.green} />
                <Muted>Every interval is covered. {data.rosterCount} roster rows read for this day.</Muted>
              </>
            ) : (
              <>
                <TriangleAlert size={14} color={P.brick} />
                <Muted>
                  {cov.understaffedIntervals} interval{cov.understaffedIntervals === 1 ? " is" : "s are"} short.
                  {canRoster ? " Add cover on the roster, or move a training block out of the peak." : " WFM and your lead can move cover into them."}
                </Muted>
              </>
            )}
            {data.clashes > 0 && (
              <Tip label="Two rostered activities claiming the same minutes for one person">
                <span className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 10.5, color: P.brick, border: `1px solid ${P.brick}`, borderRadius: 999, padding: "2px 8px" }}>
                  {data.clashes} clash{data.clashes === 1 ? "" : "es"}
                </span>
              </Tip>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }) {
  return (
    <Tip label={hint} side="bottom" fill>
      <div className="p-3 ao-glass gradient-hairline" style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 12 }}>
        <div className="ao-mono font-semibold ao-fluid-num" style={{ color: tone }}>{value}</div>
        <div className="ao-disp uppercase tracking-wider font-semibold mt-1" style={{ fontSize: 10.5, color: P.sub }}>
          {label}
          {hint ? <span className="sr-only"> — {hint}</span> : null}
        </div>
      </div>
    </Tip>
  );
}

function Legend({ tone, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ width: 8, height: 8, borderRadius: 2, background: alpha(tone, 0.75), display: "inline-block" }} />
      <span className="ao-disp uppercase tracking-wide" style={{ fontSize: 9.5, color: P.sub }}>{label}</span>
    </span>
  );
}

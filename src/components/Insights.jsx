"use client";

/* Insights: where people went, what leave is owed, and who is worth a
   conversation.

   The rule that shapes this screen is that a figure appears with what
   qualifies it, or it does not appear. A headcount waterfall renders only when
   it reconciles and contains no impossible rows; a leave liability shows the
   count of people it could not price; a risk list leads with the sentence
   rather than the count. Three ways of saying the same thing: a number on a
   management screen gets quoted in a meeting nobody in this room attends, so it
   has to carry its own caveat.

   The flight-risk list is the part to be careful with. It is a list of people,
   sorted by how many signals fired, and it would be very easy to make it feel
   like a ranking of who to manage out. It is not one, and the copy says so
   plainly — the signals are reasons to talk to someone, and the most common
   right outcome is finding out the data was missing context. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Users, Wallet, MessageCircle, TriangleAlert, RefreshCw } from "lucide-react";

import { P, alpha } from "../lib/tokens.js";
import { todayStr, addDays } from "../lib/dates.js";
import { SectionTitle, Muted, BtnGhost, TSelect, Field } from "./ui/index.jsx";
import Tip from "./ui/Tip.jsx";

const WINDOWS = [
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "180", label: "Last 6 months", days: 180 },
  { id: "365", label: "Last 12 months", days: 365 },
];

const BAND_TONE = { none: P.sub, watch: P.sub, conversation: P.amber, urgent: P.brick };

export default function Insights({ accounts = [] }) {
  const [windowId, setWindowId] = useState("180");
  const [account, setAccount] = useState("");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const to = todayStr();
      const from = addDays(to, -(WINDOWS.find((w) => w.id === windowId)?.days ?? 180));
      const q = new URLSearchParams({ from, to, ...(account ? { account } : {}) });
      const r = await fetch(`/api/analytics?${q}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load insights.");
      setData(j);
    } catch (e) {
      setError(e.message);
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [windowId, account]);

  useEffect(() => { load(); }, [load]);

  const m = data?.movement;
  const maxMonth = useMemo(
    () => Math.max(1, ...(data?.joinersByMonth ?? []).map((x) => x.count), ...(data?.leaversByMonth ?? []).map((x) => x.count)),
    [data]
  );

  return (
    <div className="grid gap-5">
      <div>
        <SectionTitle count={data?.population ?? 0} tone={P.petrol}>Insights</SectionTitle>
        <Muted>
          Movement, cost and signals for the people you can see. Every figure here is derived on read from the same
          records the rest of the app uses — nothing is a stored summary that can drift.
        </Muted>
      </div>

      <div className="p-4 flex items-end gap-3 flex-wrap" style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 12 }}>
        <Field label="Window">
          <TSelect value={windowId} onChange={(e) => setWindowId(e.target.value)}>
            {WINDOWS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </TSelect>
        </Field>
        <Field label="Account">
          <TSelect value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </TSelect>
        </Field>
        <BtnGhost icon={RefreshCw} onClick={load} disabled={busy}>Refresh</BtnGhost>
        {m && <Muted>{m.from} → {m.to}</Muted>}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8 }} role="alert">
          <TriangleAlert size={15} color={P.brick} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, color: P.inkSoft }}>{error}</span>
        </div>
      )}

      {/* ── Movement ── */}
      {m && !m.trustworthy && (
        <div className="p-3" style={{ background: P.amberWash, border: `1px solid ${alpha(P.amber, 0.4)}`, borderRadius: 8 }}>
          <div className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 10.5, color: P.amber }}>
            This movement figure is not worth quoting
          </div>
          <div style={{ fontSize: 12.5, color: P.inkSoft, marginTop: 4 }}>
            {m.impossible.length > 0
              ? `${m.impossible.length} record${m.impossible.length === 1 ? " has" : "s have"} an exit date before the hire date, or a future hire date with an exit. Fix those records and this will settle.`
              : `Opening ${m.opening} + ${m.joiners} joiners − ${m.leavers} leavers is ${m.closingComputed}, but ${m.closing} people are actually employed at the end of the window.`}
          </div>
        </div>
      )}

      {m && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat label="Opening" value={m.opening} hint={`Employed on ${m.from}`} tone={P.sub} />
          <Stat label="Joiners" value={m.joiners} hint="Hired inside the window" tone={P.green} icon={TrendingUp} />
          <Stat label="Leavers" value={m.leavers} hint="Exited inside the window" tone={m.leavers ? P.brick : P.sub} icon={TrendingDown} />
          <Stat label="Closing" value={m.closing} hint={`Employed on ${m.to}`} tone={P.petrol} icon={Users} />
          <Stat
            label="Attrition"
            value={data.attritionRate === null ? "—" : `${data.attritionRate}%`}
            hint={
              data.attritionRate === null
                ? "No headcount to measure against — a rate on nobody is undefined, not zero"
                : `${m.leavers} leavers against an average headcount of ${(m.opening + m.closing) / 2}`
            }
            tone={data.attritionRate === null ? P.sub : data.attritionRate > 20 ? P.brick : P.amber}
          />
        </div>
      )}

      {/* ── Joiners and leavers by month ── */}
      {data?.joinersByMonth?.length > 0 && (
        <div className="p-4" style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 12 }}>
          <div className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 10.5, letterSpacing: 0.9, color: P.sub, marginBottom: 10 }}>
            In and out, by month
          </div>
          <div className="flex items-end gap-2" style={{ height: 120 }}>
            {data.joinersByMonth.map((j, i) => {
              const l = data.leaversByMonth[i] ?? { count: 0 };
              return (
                <Tip key={j.month} label={`${j.month}: ${j.count} in, ${l.count} out`} fill>
                  <div className="grid gap-0.5" style={{ height: 120, alignContent: "end" }}>
                    <div style={{ height: `${(j.count / maxMonth) * 52}px`, background: alpha(P.green, 0.75), borderRadius: 2 }} />
                    <div style={{ height: `${(l.count / maxMonth) * 52}px`, background: alpha(P.brick, 0.75), borderRadius: 2 }} />
                    <div className="ao-mono" style={{ fontSize: 8.5, color: P.sub, textAlign: "center" }}>
                      {j.month.slice(5)}
                    </div>
                  </div>
                </Tip>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <Legend tone={P.green} label="Joined" />
            <Legend tone={P.brick} label="Left" />
            {data.split.total > 0 && (
              <Muted>
                Of {data.split.total} leavers: {data.split.voluntary} resigned, {data.split.involuntary} were exited
                {data.split.unclassified > 0 ? `, ${data.split.unclassified} unclassified` : ""}.
              </Muted>
            )}
          </div>
        </div>
      )}

      {/* ── Leave liability ── */}
      {data?.liability && (
        <div className="p-4" style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 12 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <Wallet size={14} color={P.petrol} />
            <span className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 10.5, letterSpacing: 0.9, color: P.sub }}>
              Accrued leave liability
            </span>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="ao-mono font-semibold" style={{ fontSize: 26, color: P.ink }}>
              EGP {data.liability.display}
            </span>
            {/* The days and the money are different populations when someone
                has no salary on file, so they are stated as different facts
                rather than joined by an "across" that reads as one. */}
            <span style={{ fontSize: 12.5, color: P.sub }}>
              {data.liability.days} days owed in total
              {data.liability.pricedPeople > 0
                ? ` · ${data.liability.pricedPeople} ${data.liability.pricedPeople === 1 ? "person" : "people"} priced`
                : " · nobody priced yet"}
            </span>
          </div>
          {!data.liability.complete && (
            <div className="mt-2" style={{ fontSize: 12.5, color: P.amber }}>
              {data.liability.unpricedPeople} {data.liability.unpricedPeople === 1 ? "person has" : "people have"} no
              salary on record, so their balance is counted in the days but not in the money. The figure is a floor,
              not a total.
            </div>
          )}
          <Muted>
            What it would cost to pay out every untaken day today, each person at their own daily rate. Under Egyptian
            law an employee leaving is paid for their balance, so this is a real liability rather than a projection.
          </Muted>
        </div>
      )}

      {data && !data.canSeePay && (
        <Muted>Leave liability is part of pay, so it is only shown to roles that may see salaries.</Muted>
      )}

      {/* ── Signals ── */}
      {data?.risks && (
        <div className="p-4" style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 12 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
            <MessageCircle size={14} color={P.petrol} />
            <span className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 10.5, letterSpacing: 0.9, color: P.sub }}>
              Worth a conversation
            </span>
          </div>
          <Muted>
            People whose records show signals often associated with leaving. This is not a prediction and not a
            ranking of who to manage out — the most common right outcome is discovering the data was missing something
            you already knew.
          </Muted>

          {data.risks.length === 0 && <div className="mt-3"><Muted>No signals across your teams.</Muted></div>}

          <div className="grid gap-2 mt-3">
            {data.risks.map((r) => (
              <div key={r.employeeId} className="p-3" style={{ background: "var(--mist)", borderRadius: 9 }}>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span style={{ fontSize: 13, fontWeight: 600, color: P.ink }}>{r.name}</span>
                  <span className="ao-mono" style={{ fontSize: 10.5, color: P.sub }}>{r.empId}</span>
                  <span style={{ fontSize: 11.5, color: P.sub }}>{r.account}</span>
                  <span className="flex-1" />
                  <Tip label="How many signals fired — not a score, and not a probability">
                    <span
                      className="ao-disp uppercase tracking-wide font-semibold"
                      style={{ fontSize: 9.5, color: BAND_TONE[r.band] ?? P.sub, border: `1px solid ${BAND_TONE[r.band] ?? P.line}`, borderRadius: 999, padding: "1px 8px" }}
                    >
                      {r.band}
                    </span>
                  </Tip>
                </div>
                <ul className="mt-1.5 grid gap-0.5" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {r.signals.map((s) => (
                    <li key={s.code} style={{ fontSize: 12, color: P.inkSoft }}>
                      <strong style={{ fontWeight: 600 }}>{s.label}</strong> — <span style={{ color: P.sub }}>{s.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone, icon: Icon }) {
  return (
    <Tip label={hint} side="bottom" fill>
      <div className="p-3 ao-glass gradient-hairline" style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 12 }}>
        <div className="flex items-center gap-2">
          {Icon && <Icon size={13} color={tone} />}
          <div className="ao-mono font-semibold ao-fluid-num" style={{ color: tone }}>{value}</div>
        </div>
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

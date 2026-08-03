"use client";

/* An agent's own payslips.

   The design question here is what to show when a payslip cannot be issued —
   no salary on record, or statutory rates nobody has configured. The tempting
   answer is to hide the month. The right answer is to show it and say why,
   because "my August payslip isn't there" is a question the person will ask
   their team lead, who will ask HR, who will find that nobody entered a salary.
   A visible reason short-circuits three conversations.

   Statutory rates being absent is deliberately *not* treated as a failure: the
   slip is still issued, still adds up, and says on its face that it is gross
   less absence rather than a final net figure. Withholding a payslip because
   the tax table is not loaded would tell an agent nothing at all. */

import { useCallback, useEffect, useState } from "react";
import { Receipt, Download, TriangleAlert, ChevronDown } from "lucide-react";

import { GlassCard, GlassBadge } from "../glass";

/* Theme-aware, not slate-*. The portal renders in whichever theme the person
   chose, and `text-slate-200` is near-white — correct on the dark shell and
   invisible on the light one. Money is the last thing that should be hard to
   read, so these follow the same CSS variables the rest of the app themes
   with. */
const INK = { color: "var(--ink)" };
const SOFT = { color: "var(--ink-soft)" };
const SUB = { color: "var(--sub)" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The last `n` complete months, most recent first. A payslip for a month that
    has not finished is a forecast, not a payslip. */
function recentPeriods(n = 6) {
  const out = [];
  const now = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const label = (period) => {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1] ?? period} ${y}`;
};

export default function MyPayslips() {
  const [periods] = useState(() => recentPeriods(6));
  const [open, setOpen] = useState("");
  const [slips, setSlips] = useState({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async (period) => {
    if (slips[period]) return;
    setBusy(period);
    try {
      const res = await fetch(`/api/payslips?period=${period}`);
      const j = await res.json();
      setSlips((s) => ({ ...s, [period]: res.ok ? j : { error: j.error || "Could not load this payslip." } }));
    } catch {
      setSlips((s) => ({ ...s, [period]: { error: "Could not reach the server." } }));
    } finally {
      setBusy("");
    }
  }, [slips]);

  // The most recent complete month is the one anyone actually wants.
  useEffect(() => { if (periods[0]) { setOpen(periods[0]); load(periods[0]); } }, [periods]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (period) => {
    const next = open === period ? "" : period;
    setOpen(next);
    if (next) load(next);
  };

  return (
    <GlassCard>
      <div className="mb-3 flex items-center gap-2">
        <Receipt size={15} style={{ color: "var(--signal)" }} />
        <h2 className="text-[13px] font-semibold uppercase tracking-wide" style={INK}>My payslips</h2>
      </div>

      <div className="grid gap-2">
        {periods.map((period) => {
          const slip = slips[period];
          const isOpen = open === period;
          return (
            <div key={period} className="rounded-xl border"
              style={{ borderColor: "var(--line)", background: "var(--mist)" }}>
              <button
                onClick={() => toggle(period)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
              >
                <span className="flex-1 text-[13px] font-semibold" style={INK}>{label(period)}</span>
                {slip?.netDisplay && !slip.error && (
                  <span className="font-mono text-[13px]" style={INK}>
                    {slip.currency} {slip.netDisplay}
                  </span>
                )}
                {slip?.error && <GlassBadge tone="rose">Unavailable</GlassBadge>}
                <ChevronDown
                  size={14}
                  className="transition-transform"
                  style={{ color: "var(--sub)", transform: isOpen ? "rotate(180deg)" : "none" }}
                />
              </button>

              {isOpen && (
                <div className="border-t px-3 py-3" style={{ borderColor: "var(--line)" }}>
                  {busy === period && <p className="text-[12px]" style={SUB}>Loading…</p>}

                  {slip?.error && <p className="text-[12px]" style={{ color: "var(--brick)" }}>{slip.error}</p>}

                  {slip && !slip.error && !slip.issuable && (
                    <div className="flex items-start gap-2 rounded-lg p-2.5" style={{ background: "var(--brick-wash)" }}>
                      <TriangleAlert size={13} className="mt-0.5 shrink-0" style={{ color: "var(--brick)" }} />
                      <div className="text-[12px]" style={SOFT}>
                        This payslip cannot be issued yet:
                        <ul className="mt-1 list-disc ps-4">
                          {slip.problems.map((p) => <li key={p}>{p}</li>)}
                        </ul>
                        Ask HR to check your record — nothing here can be fixed from your side.
                      </div>
                    </div>
                  )}

                  {slip && !slip.error && slip.issuable && (
                    <>
                      <Lines title="Earnings" rows={slip.earnings} currency={slip.currency} />
                      {slip.deductions.length > 0 && (
                        <Lines title="Deductions" rows={slip.deductions} currency={slip.currency} negative />
                      )}
                      <div className="mt-3 flex items-center gap-3 border-t pt-2.5" style={{ borderColor: "var(--line)" }}>
                        <span className="text-[12px] font-semibold uppercase tracking-wide" style={SOFT}>Net pay</span>
                        <span className="flex-1" />
                        <span className="font-mono text-[15px] font-semibold" style={INK}>
                          {slip.currency} {slip.netDisplay}
                        </span>
                      </div>

                      {slip.notes?.map((n) => (
                        <p key={n} className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--amber)" }}>{n}</p>
                      ))}

                      <a
                        href={`/api/payslips/pdf?period=${period}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition"
                        style={{ borderColor: "var(--line)", background: "var(--mist)", ...INK }}
                      >
                        <Download size={12} /> Download PDF
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

/* Each line carries its derivation underneath. It is the whole reason the
   engine returns `how` — a payslip an agent cannot check is a payslip an agent
   has to take on trust, and pay is the last thing anyone takes on trust. */
function Lines({ title, rows, currency, negative }) {
  return (
    <div className="mt-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={SUB}>{title}</div>
      <div className="mt-1 grid gap-1.5">
        {rows.map((l) => (
          <div key={l.code + l.label}>
            <div className="flex items-baseline gap-3">
              <span className="text-[12.5px]" style={SOFT}>{l.label}</span>
              <span className="flex-1 border-b border-dotted" style={{ borderColor: "var(--line)" }} />
              <span className="font-mono text-[12.5px]" style={INK}>
                {negative ? "− " : ""}{currency} {l.display}
              </span>
            </div>
            {l.how && <div className="text-[10.5px] leading-snug" style={SUB}>{l.how}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

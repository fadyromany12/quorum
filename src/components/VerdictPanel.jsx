/* The signature element: what the matrix says, the moment the TL has typed
   enough to say it. Occurrence number, prescribed action, what payroll may
   actually deduct after the statutory caps, and the agent's rights. */

import { Scale, ShieldAlert, ArrowRight, RefreshCw } from "lucide-react";
import { Pill } from "./ui/index.jsx";
import { P, sevColor } from "../lib/tokens.js";
import { LAW_CITATION, PER_INCIDENT_CAP, PER_MONTH_CAP } from "../lib/constants.js";
import { fmtDateLong, days } from "../lib/format.js";

const INK_TEXT = "var(--hdr-strong)";
const INK_SOFT = "var(--deep-ink-soft)";
const INK_ACCENT = "var(--deep-accent)";

export default function VerdictPanel({ verdict }) {
  if (!verdict) return null;
  const sev = verdict.severity ? sevColor(verdict.severity) : P.green;
  const cap = verdict.cap || { prescribed: 0, applied: 0 };
  const capped = cap.prescribed > cap.applied;

  return (
    <div className="ao-glass gradient-hairline" style={{ background: P.deep, borderRadius: 10, overflow: "hidden", border: `1px solid ${P.line}` }}>
      <div className="flex">
        <div style={{ width: 6, background: sev, flexShrink: 0 }} />
        <div className="p-4 flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="ao-mono font-semibold" style={{ fontSize: 12, color: INK_ACCENT, letterSpacing: 1 }}>
              {verdict.disciplinary ? `OCCURRENCE Nº ${verdict.occ}` : "EXCUSED / LEAVE"}
            </span>
            {verdict.severity && (
              <Pill color={sev} filled>
                {verdict.severity}
              </Pill>
            )}
            <Pill color={INK_ACCENT}>Executor · {verdict.executor}</Pill>
            {verdict.reclassifiedFrom && (
              <Pill color={P.amber} filled title="Quota spent — the policy reclassifies this">
                <RefreshCw size={10} className="mr-1" />
                Reclassified from {verdict.reclassifiedFrom}
              </Pill>
            )}
          </div>

          <div className="ao-disp font-semibold mt-2" style={{ fontSize: 20, color: INK_TEXT, lineHeight: 1.2 }}>
            {verdict.action}
          </div>

          {verdict.resetOn && verdict.disciplinary && (
            <div className="ao-mono mt-1" style={{ fontSize: 11.5, color: INK_ACCENT }}>
              Resets {fmtDateLong(verdict.resetOn)} if no recurrence
            </div>
          )}

          {cap.prescribed > 0 && <DeductionBar cap={cap} capped={capped} />}

          {verdict.notes.map((n, i) => (
            <div key={i} className="mt-1" style={{ fontSize: 12.5, color: INK_SOFT }}>
              • {n}
            </div>
          ))}
        </div>
      </div>

      {verdict.investigation && <InvestigationBanner severity={verdict.severity} />}
      {cap.prescribed > 0 && <LawStrip capped={capped} cap={cap} />}
    </div>
  );
}

/* Prescribed vs collectable, side by side — the gap is the point. */
function DeductionBar({ cap, capped }) {
  return (
    <div
      className="mt-3 p-3 flex items-center gap-3 flex-wrap"
      style={{ background: "var(--deep-well)", borderRadius: 6, border: `1px solid ${capped ? P.amber : "var(--deep-line)"}` }}
    >
      <Scale size={16} color={capped ? P.amber : INK_ACCENT} />
      <div>
        <div className="ao-disp uppercase tracking-wider font-semibold" style={{ fontSize: 10, color: INK_ACCENT }}>
          Matrix prescribes
        </div>
        <div className="ao-mono font-semibold" style={{ fontSize: 16, color: INK_TEXT }}>
          {days(cap.prescribed)}
        </div>
      </div>

      <ArrowRight size={16} color={INK_ACCENT} />

      <div>
        <div className="ao-disp uppercase tracking-wider font-semibold" style={{ fontSize: 10, color: INK_ACCENT }}>
          Payroll may deduct
        </div>
        <div className="ao-mono font-semibold" style={{ fontSize: 16, color: capped ? P.amber : P.green }}>
          {days(cap.applied)}
        </div>
      </div>

      {capped && (
        <>
          <span className="flex-1" />
          <Pill color={P.amber} filled>
            Cap applied · {days(cap.waived)} waived
          </Pill>
        </>
      )}

      {!capped && cap.headroom < PER_MONTH_CAP && (
        <>
          <span className="flex-1" />
          <span className="ao-mono" style={{ fontSize: 11.5, color: INK_ACCENT }}>
            {cap.monthUsed} of {PER_MONTH_CAP} days used this month
          </span>
        </>
      )}
    </div>
  );
}

function LawStrip({ capped, cap }) {
  return (
    <div
      className="px-4 py-2 flex items-center gap-2"
      style={{ background: capped ? "var(--cap-bg)" : "var(--deep-well)", borderTop: `1px solid ${capped ? P.amber : "var(--deep-line)"}` }}
    >
      <Scale size={13} color={capped ? P.amber : INK_ACCENT} />
      <span style={{ fontSize: 11.5, color: capped ? "var(--cap-text)" : INK_ACCENT }}>
        {LAW_CITATION} — deductions capped at {PER_INCIDENT_CAP} days per incident and {PER_MONTH_CAP} days per calendar
        month.
        {capped && ` This incident is limited to ${days(cap.applied)}; ${days(cap.waived)} cannot be collected.`}
      </span>
    </div>
  );
}

function InvestigationBanner({ severity }) {
  const zt = severity === "Zero Tolerance";
  return (
    <div
      className="px-4 py-3 flex items-start gap-2"
      style={{ background: zt ? "var(--zt-bg-strong)" : "var(--zt-bg)", borderTop: `1px solid ${P.brick}` }}
    >
      <ShieldAlert size={16} color="var(--coral-soft)" style={{ flexShrink: 0, marginTop: 1 }} />
      <div>
        <div className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 12, color: "var(--coral-text)" }}>
          Investigation protocols active
        </div>
        <div className="mt-1" style={{ fontSize: 12, color: "var(--coral-dim)", lineHeight: 1.5 }}>
          The employee must be notified in writing and holds the right to a <b>3–5 working day</b> written response
          window and to have a colleague present during review. No deduction or termination may be executed before the
          investigation concludes.
          {zt && " Immediate suspension pending investigation may apply."}
        </div>
      </div>
    </div>
  );
}

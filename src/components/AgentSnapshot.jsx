/* Who is this person, and where do they already stand? Rendered beside the log
   form the instant an email matches something in the ledger. */

import { UserRound, AlertTriangle, Scale, CalendarHeart } from "lucide-react";
import { Pill } from "./ui/index.jsx";
import { P, accColor, sevColor, alpha } from "../lib/tokens.js";
import { fmtMin, fmtDate, days } from "../lib/format.js";
import { PER_MONTH_CAP, EMERGENCY_QUOTA } from "../lib/constants.js";

export default function AgentSnapshot({ summary, known }) {
  if (!known) {
    return (
      <div className="p-4" style={{ background: P.card, border: `1px dashed ${P.line}`, borderRadius: 10 }}>
        <div className="flex items-center gap-2">
          <UserRound size={15} color={P.sub} />
          <div className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 12, color: P.sub }}>
            No history
          </div>
        </div>
        <div className="mt-2" style={{ fontSize: 12.5, color: P.sub }}>
          No previous cases for this address — every violation will be logged as a 1st occurrence.
        </div>
      </div>
    );
  }

  const capHit = summary.monthDeduction >= PER_MONTH_CAP;

  return (
    <div className="p-4" style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 10 }}>
      <div className="flex items-center gap-2 flex-wrap">
        <UserRound size={15} color={P.petrol} />
        <span className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 12, color: P.ink }}>
          Agent standing
        </span>
        <span className="flex-1" />
        {summary.account && (
          <span className="inline-flex items-center gap-1" style={{ fontSize: 11.5, color: P.sub }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: accColor(summary.account) }} />
            {summary.account}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <Stat label="Cases" value={summary.live} hint={summary.dismissed ? `${summary.dismissed} dismissed` : ""} />
        <Stat label="Hours lost" value={fmtMin(summary.hoursLost)} tone={P.brick} />
        <Stat
          label="Deducted / mo"
          value={`${summary.monthDeduction}/${PER_MONTH_CAP}`}
          tone={capHit ? P.amber : P.ink}
          hint={capHit ? "cap reached" : ""}
        />
      </div>

      {summary.activeWarnings.length > 0 && (
        <div className="mt-3">
          <div className="ao-disp uppercase tracking-wider font-semibold flex items-center gap-1" style={{ fontSize: 10.5, color: P.sub }}>
            <AlertTriangle size={11} /> Active warnings
          </div>
          <div className="grid gap-1.5 mt-1.5">
            {summary.activeWarnings.map((w) => (
              <div key={w.violation} className="flex items-center gap-2">
                <span style={{ width: 6, height: 6, borderRadius: 999, background: sevColor(w.severity), flexShrink: 0 }} />
                <span className="truncate" style={{ fontSize: 12.5, color: P.inkSoft, flex: 1 }}>
                  {w.violation}
                </span>
                <Pill color={sevColor(w.severity)}>№{w.occ}</Pill>
                <span className="ao-mono" style={{ fontSize: 11, color: P.sub, whiteSpace: "nowrap" }}>
                  {w.daysLeft}d left
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary.activeWarnings.length === 0 && (
        <div className="mt-3" style={{ fontSize: 12.5, color: P.green }}>
          No active warnings — every earlier chain has passed its 90-day reset.
        </div>
      )}

      {summary.emergency.used > 0 && (
        <div className="mt-3 flex items-center gap-2 p-2" style={{ background: P.mist, borderRadius: 6 }}>
          <CalendarHeart size={13} color={summary.emergency.used >= EMERGENCY_QUOTA ? P.brick : P.sub} />
          <span style={{ fontSize: 12, color: P.inkSoft }}>
            Emergency leave: <b>{summary.emergency.used}</b> of {EMERGENCY_QUOTA} days used this year
          </span>
        </div>
      )}

      {capHit && (
        <div className="mt-2 flex items-start gap-2 p-2" style={{ background: P.amberWash, border: `1px solid ${alpha(P.amber, 0.33)}`, borderRadius: 6 }}>
          <Scale size={13} color={P.amber} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: 12, color: P.inkSoft }}>
            Monthly deduction cap reached — {days(summary.monthDeduction)} already taken. Any further deduction this
            month is not collectable.
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone, hint }) {
  return (
    <div className="p-2" style={{ background: P.mist, borderRadius: 6 }}>
      <div className="ao-mono font-semibold" style={{ fontSize: 15, color: tone || P.ink, lineHeight: 1.2 }}>
        {value}
      </div>
      <div className="ao-disp uppercase tracking-wider font-semibold" style={{ fontSize: 9.5, color: P.sub }}>
        {label}
      </div>
      {hint && <div style={{ fontSize: 10, color: P.sub }}>{hint}</div>}
    </div>
  );
}

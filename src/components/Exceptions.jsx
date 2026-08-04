"use client";

/* Attendance exceptions — the morning list.

   One screen for the question a team lead currently answers by opening the
   roster in one tab, the live floor in another, and asking around: who did not
   turn up, who was late, who left early, who is over their breaks.

   Ordered by how much explaining each one needs rather than alphabetically. A
   no-show is a phone call to make now; an over-run break is a line for the
   one-to-one on Thursday. Sorting people by name would bury the first under the
   second.

   Every row carries a "log this" that opens the case form with the matrix rule
   already chosen. That is the whole point of the screen — the exception and the
   case were always the same event, and retyping the agent, the date and the
   violation is where the accuracy went. It stops at pre-filling: the lead still
   writes the context and presses the button, because an automatically opened
   disciplinary case is a disciplinary case nobody reviewed.

   The undetermined list is shown, not hidden. A day the engine could not judge
   is usually a hole in the roster, and the lead is the person who can close
   it. */

import { useCallback, useEffect, useState } from "react";
import {
  TriangleAlert, Clock, LogOut, CalendarX, CalendarClock, Coffee, RefreshCw, ClipboardPlus, CircleHelp,
} from "lucide-react";
import { Card, Pill, Muted, BtnGhost, TInput, TSelect } from "./ui/index.jsx";
import { P, alpha, accColor } from "../lib/tokens.js";
import { todayStr } from "../lib/dates.js";
import { plural } from "../lib/format.js";
import { EXCEPTION_KINDS } from "../lib/exceptions.js";

const ICON = {
  noShow: CalendarX,
  late: Clock,
  leftEarly: LogOut,
  unscheduled: CalendarClock,
  overBreak: Coffee,
  tooManyBreaks: Coffee,
};

/* Colour by how much it matters, not by which kind it is — the eye should sort
   the list before the reader does. */
const TONE = {
  noShow: P.brick,
  leftEarly: P.brick,
  late: P.amber,
  unscheduled: P.amber,
  tooManyBreaks: P.sub,
  overBreak: P.sub,
};

const mins = (s) => `${Math.round(s / 60)}m`;

/** The detail line for one exception — whatever that kind actually measured. */
function detailOf(row) {
  switch (row.kind) {
    case "late":
      return `${mins(row.bySeconds)} after start${row.adherencePct != null ? ` · ${row.adherencePct}% adherence` : ""}`;
    case "leftEarly":
      return `${mins(row.bySeconds)} before the end${row.adherencePct != null ? ` · ${row.adherencePct}% adherence` : ""}`;
    case "noShow":
      return row.scheduledStart ? `Scheduled ${row.scheduledStart}` : "Scheduled to work";
    case "unscheduled":
      return `${row.minutes}m worked with nothing rostered`;
    case "overBreak":
      return `${row.aux} — ${mins(row.overBySeconds)} over the ${mins(row.limitSeconds)} limit`;
    case "tooManyBreaks":
      return `${row.aux} — ${row.count} times, limit ${row.maxPerShift}`;
    default:
      return "";
  }
}

export default function Exceptions({ accounts = [], onLogCase }) {
  const [date, setDate] = useState(todayStr());
  const [account, setAccount] = useState("All");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/attendance/exceptions?date=${date}&account=${encodeURIComponent(account)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load exceptions.");
      setData(json);
    } catch (e) {
      setError(e.message);
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [date, account]);

  useEffect(() => { load(); }, [load]);

  const rows = data?.rows ?? [];
  const s = data?.summary ?? { total: 0, people: 0, byKind: {} };

  return (
    <div className="grid gap-4">
      <Card
        title={<span className="inline-flex items-center gap-2"><TriangleAlert size={14} />Attendance exceptions</span>}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <TInput type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} />
            <TSelect value={account} onChange={(e) => setAccount(e.target.value)} style={{ width: 130 }}>
              <option value="All">All accounts</option>
              {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
            </TSelect>
            <BtnGhost icon={RefreshCw} onClick={load} disabled={busy}>{busy ? "Checking…" : "Refresh"}</BtnGhost>
          </div>
        }
      >
        <Muted>
          Where the roster and the clock disagree. Approved leave is checked first, so someone on
          annual leave is not reported as a no-show — and nothing is judged before it has finished.
        </Muted>

        {error && (
          <div className="mt-3 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 13 }} role="alert">
            {error}
          </div>
        )}

        {data && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pill color={s.total ? P.amber : P.green} filled={!!s.total}>
              {s.total ? `${plural(s.total, "exception")} · ${plural(s.people, "person", "people")}` : "Nothing to explain"}
            </Pill>
            <Muted>of {plural(data.people, "person", "people")} on the floor</Muted>
            {Object.entries(s.byKind).map(([k, n]) => (
              <Pill key={k} color={TONE[k] ?? P.sub}>{EXCEPTION_KINDS[k]?.label ?? k}: {n}</Pill>
            ))}
          </div>
        )}
      </Card>

      {rows.length > 0 && (
        <Card title="Needs a look" right={<Pill color={P.amber}>{rows.length}</Pill>}>
          <div className="grid gap-1.5">
            {rows.map((r, i) => {
              const Icon = ICON[r.kind] ?? TriangleAlert;
              const tone = TONE[r.kind] ?? P.sub;
              return (
                <div
                  key={`${r.employeeId}-${r.kind}-${i}`}
                  className="flex flex-wrap items-center gap-2.5 p-2.5"
                  style={{ borderInlineStart: `3px solid ${tone}`, background: P.mist, borderRadius: 8 }}
                >
                  <Icon size={14} color={tone} className="shrink-0" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: P.ink, minWidth: 150 }}>{r.employeeName}</span>
                  <span className="ao-mono" style={{ fontSize: 11.5, color: P.sub }}>{r.empId}</span>
                  {r.account && (
                    <span style={{ fontSize: 11, color: accColor(r.account) }}>{r.account}{r.lob ? ` · ${r.lob}` : ""}</span>
                  )}
                  <Pill color={tone}>{EXCEPTION_KINDS[r.kind]?.label ?? r.kind}</Pill>
                  <span style={{ fontSize: 12, color: P.inkSoft }}>{detailOf(r)}</span>
                  {onLogCase && (
                    <span className="ms-auto">
                      <BtnGhost
                        icon={ClipboardPlus}
                        title={`Open the case form with "${r.violationId}" already chosen`}
                        onClick={() => onLogCase({ employeeId: r.employeeId, name: r.employeeName, empId: r.empId, account: r.account, date: r.date, violationId: r.violationId })}
                      >
                        Log this
                      </BtnGhost>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {data?.undetermined?.length > 0 && (
        <Card title={<span className="inline-flex items-center gap-2"><CircleHelp size={14} />Could not tell</span>}>
          <Muted>
            These are gaps rather than exceptions — usually a missing roster row. The engine stays
            quiet rather than guessing, because a guess here becomes a warning on someone&rsquo;s file.
          </Muted>
          <div className="mt-2 grid gap-1">
            {data.undetermined.map((u, i) => (
              <div key={`${u.employeeId}-${i}`} style={{ fontSize: 12.5, color: P.sub }}>
                <span style={{ color: P.inkSoft }}>{u.name}</span> — {u.reason}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

"use client";

/* When do I work next.

   This is the reason a shift worker opens a workforce app, and it was the one
   thing the portal could not answer. Rosters were planned, published, swapped
   against and compared to the floor — by everybody except the person working
   them.

   The layout follows the question rather than the data. The next shift is a
   headline, because that is what somebody checks at 11pm on a Sunday; the
   fortnight grid is underneath, because that is what they check when arranging
   anything else.

   Three things it refuses to do:

     · Draw a blank square for a day nobody has rostered. That reads as a day
       off, and it is not one — it is a day the roster does not cover yet.
     · Show a start time without an end. Night shifts cross midnight and the
       arithmetic is where the mistake lives.
     · Stay quiet when the published roster runs out. "No shifts" looks like a
       quiet fortnight and is usually an unpublished one. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, RefreshCw, Moon, Info } from "lucide-react";
import { Card, Muted, Pill, BtnGhost } from "../ui/index.jsx";
import { P, alpha } from "../../lib/tokens.js";
import { buildWeeks, nextShift, untilText, horizon, DAY_SHORT } from "../../lib/myschedule.js";

/* Colour carries meaning here, so it comes from the activity rather than from
   the row's position: a training day two weeks out should look the same as one
   tomorrow. */
const TONE = {
  Shift: P.petrol,
  Overtime: P.amber,
  Training: P.petrol ?? P.petrol,
  Meeting: P.sub,
  Coaching: P.sub,
  Leave: P.green,
  Off: "var(--dim)",
};

function Day({ day }) {
  const first = day.entries[0] ?? null;
  const tone = first ? TONE[first.activity] ?? P.sub : "var(--dim)";

  return (
    <div
      style={{
        border: `1px solid ${day.isToday ? alpha(P.petrol, 0.5) : alpha(P.ink, 0.1)}`,
        background: day.isToday ? P.signalWash : day.isPast ? "transparent" : "var(--well)",
        opacity: day.isPast ? 0.55 : 1,
        borderRadius: 9,
        padding: "7px 8px",
        minWidth: 0,
      }}
    >
      {/* A row on a phone, a column on a screen.

          Seven columns is the right shape for a week and the wrong one for a
          390px screen: "22:00 → 06:00" cannot shrink below about 90px, so seven
          of them are 630px and the page scrolls sideways to show a day nobody
          can read anyway. Below `sm` each day becomes a line — label left,
          hours right — which is how a week reads on a phone. */}
      <div className="flex sm:block items-baseline gap-2">
        <div className="flex items-baseline gap-1.5 shrink-0 sm:w-auto sm:justify-between" style={{ width: 74 }}>
          <span className="ao-disp uppercase" style={{ fontSize: 10, letterSpacing: 0.5, color: day.isToday ? P.petrol : P.sub, fontWeight: day.isToday ? 700 : 600 }}>
            {day.dayName}
          </span>
          <span className="ao-mono" style={{ fontSize: 10.5, color: P.sub }}>{day.date.slice(8)}</span>
        </div>

        <div className="min-w-0 flex-1 sm:mt-1">
          {day.state === "unscheduled" ? (
            /* Not a blank square. */
            <div style={{ fontSize: 11, color: "var(--dim)", fontStyle: "italic" }}>
              {day.isPast ? "—" : "not rostered"}
            </div>
          ) : day.state === "off" ? (
            <div style={{ fontSize: 11.5, color: "var(--dim)" }}>Day off</div>
          ) : (
            <div className="grid gap-1">
              {day.entries.map((e) => (
                <div key={e.id ?? `${e.date}-${e.startTime}`}>
                  <div className="ao-mono flex items-center gap-1" style={{ fontSize: 11.5, color: P.ink, fontWeight: 600, whiteSpace: "nowrap" }}>
                    {e.span || e.label}
                    {e.overnight && <Moon size={9} style={{ color: P.sub }} title="Runs into the next day" />}
                  </div>
                  {e.activity !== "Shift" && (
                    <div style={{ fontSize: 10, color: tone }}>{e.label}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MySchedule() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [weeks, setWeeks] = useState(2);

  const load = useCallback(async (n) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/me/schedule?weeks=${n}`);
      const j = await res.json().catch(() => ({}));
      if (res.ok) setData(j);
    } catch {
      /* Leaving the last good grid on screen beats replacing a roster somebody
         is reading with an error strip. */
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { load(weeks); }, [load, weeks]);

  const rows = data?.rows ?? [];
  const today = data?.today;
  const grid = useMemo(
    () => (data ? buildWeeks(rows, { from: data.from, weeks: data.weeks, today }) : []),
    [data, rows, today],
  );
  const next = useMemo(() => (data ? nextShift(rows, { today }) : null), [data, rows, today]);
  const reach = useMemo(
    () => (data ? horizon(data.publishedTo ? [{ date: data.publishedTo }] : [], { today }) : null),
    [data, today],
  );

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><CalendarDays size={14} />My schedule</span>}
      right={
        <div className="flex flex-wrap items-center gap-2">
          {[2, 4, 8].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setWeeks(n)}
              className="ao-disp uppercase"
              style={{
                fontSize: 10.5, letterSpacing: 0.5, padding: "3px 8px", borderRadius: 999,
                border: `1px solid ${weeks === n ? alpha(P.petrol, 0.5) : alpha(P.ink, 0.14)}`,
                background: weeks === n ? P.signalWash : "transparent",
                color: weeks === n ? P.petrol : P.sub,
              }}
            >
              {n}w
            </button>
          ))}
          <BtnGhost icon={RefreshCw} onClick={() => load(weeks)} disabled={busy}>
            {busy ? "…" : "Refresh"}
          </BtnGhost>
        </div>
      }
    >
      {!data ? (
        <Muted>Loading your roster…</Muted>
      ) : (
        <>
          {/* The headline. */}
          {next ? (
            <div
              className="p-3"
              style={{ background: P.signalWash, border: `1px solid ${alpha(P.petrol, 0.35)}`, borderRadius: 9 }}
            >
              <div className="ao-disp uppercase" style={{ fontSize: 10, letterSpacing: 0.6, color: P.petrol }}>
                Next {next.label.toLowerCase()}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-0.5">
                <strong style={{ fontSize: 17 }}>{next.when === "today" || next.when === "tomorrow" ? next.when[0].toUpperCase() + next.when.slice(1) : DAY_SHORT[new Date(`${next.date}T00:00:00Z`).getUTCDay()]}</strong>
                <span className="ao-mono" style={{ fontSize: 15, fontWeight: 600 }}>{next.span}</span>
                <span style={{ fontSize: 12.5, color: P.sub }}>{untilText(next.inMinutes)}</span>
                {next.overnight && (
                  <span className="inline-flex items-center gap-1" style={{ fontSize: 11.5, color: P.sub }}>
                    <Moon size={10} />finishes the next morning
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div
              className="p-3"
              style={{ background: P.amberWash, border: `1px solid ${alpha(P.amber, 0.35)}`, borderRadius: 9, fontSize: 13 }}
            >
              <Info size={12} style={{ display: "inline", marginInlineEnd: 6, color: P.amber }} />
              Nothing is rostered for you from here on. That usually means the next roster has not been published yet —
              ask your lead rather than assuming you are free.
            </div>
          )}

          {/* The fortnight. */}
          {grid.map((week) => (
            <div key={week.start} className="mt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="ao-disp uppercase" style={{ fontSize: 10.5, letterSpacing: 0.5, color: P.sub }}>
                  {week.start} → {week.end}
                </span>
                <span style={{ fontSize: 11.5, color: P.sub }}>
                  {week.working} {week.working === 1 ? "day" : "days"} · {week.hours}h
                  {week.unscheduled > 0 && (
                    <span style={{ color: P.amber }}> · {week.unscheduled} not rostered</span>
                  )}
                </span>
              </div>
              <div className="mt-1 grid gap-1 grid-cols-1 sm:grid-cols-7">
                {week.days.map((d) => <Day key={d.date} day={d} />)}
              </div>
            </div>
          ))}

          {reach?.short && (
            <div className="mt-3" style={{ fontSize: 12, color: P.amber }}>
              {reach.message}
            </div>
          )}
          <Muted>
            Published shifts only — your lead has to publish a roster before it appears here. A day marked
            &ldquo;not rostered&rdquo; is not a day off; it is a day the roster does not cover yet.
          </Muted>
        </>
      )}
    </Card>
  );
}

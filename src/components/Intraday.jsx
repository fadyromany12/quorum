"use client";

/* Intraday — what the queue needs, who was rostered, who is actually here.

   These three numbers all existed and had never been on one screen. The plan
   knew the first two; the floor knew the third; the question a lead actually
   asks at 13:45 — "is 14:00 going to hold?" — needs all three at once, and was
   answerable only by opening two tabs and doing the subtraction in your head.

   The bar per interval is deliberately the *live* number where there is one and
   the roster where there is not, because before a shift starts the roster is
   the only thing that can be wrong, and once it starts the roster is no longer
   the thing that matters.

   A future interval shows no live number rather than a zero. That is the whole
   discipline of this screen: zero would paint every afternoon red every
   morning, and a screen that cries wolf before lunch is one nobody reads after
   it. */

import { Activity, TriangleAlert, CircleCheck } from "lucide-react";
import { Card, Pill, Muted } from "./ui/index.jsx";
import { P } from "../lib/tokens.js";
import { INTRADAY_STATES } from "../lib/wfm.js";

const TONE = {
  covered: P.green,
  tight: P.amber,
  short: P.brick,
  unknown: "var(--dim)",
};

export default function Intraday({ rows = [], summary = null, live = false, nowInterval = null }) {
  if (!rows.length) {
    return (
      <Card title={<span className="inline-flex items-center gap-2"><Activity size={14} />Intraday</span>}>
        <Muted>Load a forecast to see what each interval needs against who is on it.</Muted>
      </Card>
    );
  }

  /* Scaled against the busiest requirement so the bars are comparable across
     the day rather than each one filling its own row. */
  const peak = Math.max(1, ...rows.map((r) => Math.max(r.required, r.rostered, r.actual ?? 0)));
  const s = summary ?? { short: 0, judged: 0, worst: null };

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><Activity size={14} />Intraday</span>}
      right={
        s.short > 0 ? (
          <Pill color={P.brick} filled>
            <TriangleAlert size={11} />
            {s.short} short
          </Pill>
        ) : (
          <Pill color={P.green}>
            <CircleCheck size={11} />
            Holding
          </Pill>
        )
      }
    >
      <Muted>
        {live
          ? "Required against rostered against who is actually logged in. Intervals still to come show no live number — not a zero."
          : "Required against rostered. The live column appears when you look at today."}
      </Muted>

      {s.worst && (
        <div className="mt-2" style={{ fontSize: 12.5, color: P.brick }}>
          Worst is <strong>{s.worst.interval}</strong> —{" "}
          {s.worst.actual === null
            ? `${Math.abs(s.worst.rosterGap)} short on the roster`
            : `${Math.abs(s.worst.liveGap)} short on the floor`}
          .
        </div>
      )}

      <div className="mt-3 grid gap-0.5">
        {/* Header */}
        <div className="flex items-center gap-2" style={{ fontSize: 10.5, color: P.sub, letterSpacing: 0.5 }}>
          <span style={{ width: 46 }}>TIME</span>
          <span style={{ width: 34, textAlign: "end" }}>NEED</span>
          <span style={{ width: 34, textAlign: "end" }}>ROST</span>
          <span style={{ width: 34, textAlign: "end" }}>HERE</span>
          <span className="flex-1" />
        </div>

        {rows.map((r) => {
          const tone = TONE[r.state] ?? P.sub;
          const shown = r.actual === null ? r.rostered : r.actual;
          const isNow = r.interval === nowInterval;
          return (
            <div
              key={r.interval}
              className="flex items-center gap-2"
              style={{
                fontSize: 12,
                padding: "2px 4px",
                borderRadius: 5,
                background: isNow ? P.signalWash : "transparent",
              }}
              title={`${INTRADAY_STATES[r.state]?.label ?? r.state}${
                r.actual === null ? "" : ` · ${r.liveGap >= 0 ? "+" : ""}${r.liveGap} against requirement`
              }`}
            >
              <span className="ao-mono" style={{ width: 46, color: isNow ? P.ink : P.sub, fontWeight: isNow ? 700 : 400 }}>
                {r.interval}
              </span>
              <span className="ao-mono" style={{ width: 34, textAlign: "end", color: P.inkSoft }}>{r.required}</span>
              <span className="ao-mono" style={{ width: 34, textAlign: "end", color: P.sub }}>{r.rostered}</span>
              <span className="ao-mono" style={{ width: 34, textAlign: "end", color: r.actual === null ? "var(--dim)" : tone, fontWeight: 600 }}>
                {/* An em dash, not a zero. */}
                {r.actual === null ? "—" : r.actual}
              </span>
              <span className="flex-1" style={{ position: "relative", height: 11 }}>
                {/* The requirement as a notch, and what is against it as a bar,
                    so short reads as a bar falling behind a line rather than as
                    two numbers to compare. */}
                <span
                  style={{
                    position: "absolute", insetInlineStart: 0, top: 3, height: 5,
                    width: `${(shown / peak) * 100}%`, background: tone, borderRadius: 3, opacity: 0.85,
                  }}
                />
                <span
                  style={{
                    position: "absolute", insetInlineStart: `${(r.required / peak) * 100}%`, top: 0,
                    width: 2, height: 11, background: P.ink, opacity: 0.55,
                  }}
                />
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

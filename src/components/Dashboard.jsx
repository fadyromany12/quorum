/* Tab A — the operations control dashboard.

   Everything here reads live entries only; dismissed cases are filtered out at
   the top so a thrown-out case never inflates hours lost or the deduction pool. */

import { useMemo } from "react";
import { PhoneCall, UserX, CalendarX2, Users, TriangleAlert, Scale, TrendingUp, TrendingDown, Minus, CalendarClock, Timer } from "lucide-react";
import { Card, Pill, Muted } from "./ui/index.jsx";
import { P, SEV_ORDER, accColor, sevColor, alpha } from "../lib/tokens.js";
import { fmtMin, fmtDate, days } from "../lib/format.js";
import { countsForDiscipline, slaFor } from "../lib/engine.js";
import { todayStr, addDays, daysBetween } from "../lib/dates.js";
import { agentKeyOf } from "../lib/identity.js";
import { upcomingResets } from "../lib/agents.js";
import { RESET_SOON_DAYS } from "../lib/constants.js";

const FLAG_ICON = { "3in30": PhoneCall, "5in60": Users, ncns: UserX, emergency: CalendarX2 };

export default function Dashboard({ entries, accounts, escalations }) {
  // Hours lost and case counts include cases still at triage — the hours were
  // lost whether or not a manager has ruled yet. Deductions do not: nothing is
  // scheduled against payroll until the case is escalated.
  const live = useMemo(() => entries.filter((e) => e.stage !== "dismissed" && !e.voided), [entries]);
  const escalated = useMemo(() => entries.filter(countsForDiscipline), [entries]);

  const perAccount = useMemo(
    () =>
      accounts.map((a) => ({
        a,
        count: live.filter((e) => e.account === a).length,
        disc: live.filter((e) => e.account === a && e.disciplinary).length,
        min: live.filter((e) => e.account === a).reduce((s, e) => s + (e.missingMin || 0), 0),
        ded: escalated.filter((e) => e.account === a).reduce((s, e) => s + (e.deductionApplied || 0), 0),
      })),
    [live, escalated, accounts]
  );
  const maxMin = Math.max(1, ...perAccount.map((p) => p.min));

  // Eight ISO-ish weeks back from today (bucket 0 = the current 7 days).
  // Counts every case — a CSAT manipulation or bad-attitude case loses no
  // minutes, so a minutes-only trend would render it invisible.
  const weekly = useMemo(() => {
    const today = todayStr();
    const buckets = Array.from({ length: 8 }, (_, i) => ({
      start: addDays(today, -7 * (8 - i) + 1),
      end: addDays(today, -7 * (7 - i)),
      min: 0,
      count: 0,
      disc: 0,
      leave: 0,
    }));
    for (const e of live) {
      const age = daysBetween(e.date, today);
      if (Number.isNaN(age) || age < 0 || age >= 56) continue;
      const idx = 7 - Math.floor(age / 7);
      buckets[idx].min += e.missingMin || 0;
      buckets[idx].count++;
      if (e.disciplinary) buckets[idx].disc++;
      else buckets[idx].leave++;
    }
    return buckets;
  }, [live]);

  const perLob = useMemo(() => {
    const m = {};
    for (const e of live) {
      const lob = e.lob || "Unassigned";
      if (!m[lob]) m[lob] = { lob, count: 0, min: 0 };
      m[lob].count++;
      m[lob].min += e.missingMin || 0;
    }
    return Object.values(m).sort((a, b) => b.min - a.min);
  }, [live]);
  const maxLob = Math.max(1, ...perLob.map((p) => p.min));

  const bySeverity = useMemo(() => {
    const m = Object.fromEntries(SEV_ORDER.map((s) => [s, 0]));
    let leave = 0;
    for (const e of live) {
      if (e.severity && m[e.severity] !== undefined) m[e.severity]++;
      else leave++;
    }
    return { tiers: SEV_ORDER.map((s) => ({ name: s, count: m[s], color: sevColor(s) })), leave };
  }, [live]);

  const byViolation = useMemo(() => {
    const m = {};
    for (const e of live) {
      if (!m[e.violation]) m[e.violation] = { count: 0, sev: e.severity };
      m[e.violation].count++;
    }
    return Object.entries(m)
      .map(([name, v]) => ({ name, ...v }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 8);
  }, [live]);
  const maxV = Math.max(1, ...byViolation.map((v) => v.count));

  // Per-violation weekly counts over the last 8 weeks, so a TL can see whether a
  // specific violation is trending down after the warnings landed — not just how
  // many there are in total. `delta` compares the recent four weeks with the
  // prior four: negative is improving (fewer), positive is worsening.
  const violationTrends = useMemo(() => {
    const today = todayStr();
    const map = {};
    for (const e of live) {
      const age = daysBetween(e.date, today);
      if (Number.isNaN(age) || age < 0 || age >= 56) continue;
      const idx = 7 - Math.floor(age / 7);
      if (!map[e.violation]) map[e.violation] = { name: e.violation, sev: e.severity, weeks: Array(8).fill(0), total: 0 };
      map[e.violation].weeks[idx]++;
      map[e.violation].total++;
    }
    return Object.values(map)
      .map((v) => {
        const prior = v.weeks.slice(0, 4).reduce((s, n) => s + n, 0);
        const recent = v.weeks.slice(4).reduce((s, n) => s + n, 0);
        return { ...v, prior, recent, delta: recent - prior };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [live]);

  // Keyed like the rest of the app — empId first, email as fallback. RTA rows
  // carry IDs but no emails; an email-only key would merge them all into one.
  const resets = useMemo(() => upcomingResets(entries, RESET_SOON_DAYS), [entries]);

  const slaBreaches = useMemo(
    () =>
      live
        .map((e) => ({ e, sla: slaFor(e) }))
        .filter((x) => x.sla && x.sla.breached)
        .sort((a, b) => b.sla.ageDays - a.sla.ageDays)
        .slice(0, 8),
    [live]
  );

  const offenders = useMemo(() => {
    const m = {};
    for (const e of escalated) {
      if (!e.disciplinary) continue;
      const key = agentKeyOf(e);
      if (!key) continue;
      if (!m[key]) m[key] = { label: "", account: e.account, count: 0, ded: 0 };
      m[key].count++;
      m[key].ded += e.deductionApplied || 0;
      m[key].label = e.agentName || e.email || e.empId || m[key].label;
      m[key].account = e.account;
    }
    return Object.values(m)
      .sort((x, y) => y.count - x.count || y.ded - x.ded)
      .slice(0, 6);
  }, [escalated]);

  return (
    <div className="grid gap-4">
      {/* Escalation flags come first — they are the reason to open this tab */}
      <Card
        title="Live escalation flags"
        right={
          escalations.length > 0 ? (
            <Pill color={P.brick} filled>
              {escalations.length} active
            </Pill>
          ) : (
            <Pill color={P.green}>All clear</Pill>
          )
        }
      >
        {escalations.length === 0 ? (
          <Muted>
            No thresholds breached. Three infractions in 30 days triggers an alignment call; five in 60 days triggers an
            HR intervention plan.
          </Muted>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 ao-stagger">
            {escalations.map((x, i) => {
              const Icon = FLAG_ICON[x.kind] || TriangleAlert;
              const c = sevColor(x.level);
              return (
                <div
                  key={i}
                  className="flex items-start gap-2 p-2.5 ao-lift"
                  style={{ background: P.amberWash, border: `1px solid ${alpha(c, 0.2)}`, borderLeft: `4px solid ${c}`, borderRadius: 6 }}
                >
                  <Icon size={15} color={c} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div className="min-w-0">
                    <div className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 12, color: c }}>
                      {x.title}
                    </div>
                    <div className="ao-mono truncate" style={{ fontSize: 12, color: P.ink }}>
                      {x.email} <span style={{ color: P.sub }}>· {x.account}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: P.inkSoft }}>{x.text}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Time-sensitive: SLA breaches and warnings about to lapse */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          title="Cases past SLA"
          right={slaBreaches.length ? <Pill color={P.brick} filled>{slaBreaches.length}</Pill> : <Pill color={P.green}>On track</Pill>}
        >
          {slaBreaches.length === 0 ? (
            <Muted>Every open case is within its stage turnaround target.</Muted>
          ) : (
            <div className="grid gap-2">
              {slaBreaches.map(({ e, sla }) => (
                <div key={e.id} className="flex items-center gap-2">
                  <Timer size={13} color={P.brick} style={{ flexShrink: 0 }} />
                  <span className="ao-mono truncate" style={{ fontSize: 12.5, color: P.ink, flex: 1 }}>
                    {e.agentName || e.email || e.empId}
                  </span>
                  <span className="truncate" style={{ fontSize: 11.5, color: P.sub, maxWidth: 130 }}>
                    {e.violation}
                  </span>
                  <Pill color={P.brick} filled>
                    {sla.ageDays}d {sla.label}
                  </Pill>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={`Warnings resetting within ${RESET_SOON_DAYS} days`}
          right={resets.length ? <Pill color={P.amber} filled>{resets.length}</Pill> : <Pill color={P.sub}>None</Pill>}
        >
          {resets.length === 0 ? (
            <Muted>No active warning chains lapse in the next {RESET_SOON_DAYS} days.</Muted>
          ) : (
            <div className="grid gap-2">
              {resets.slice(0, 8).map((w, i) => (
                <div key={`${w.empId || w.email}-${w.violation}-${i}`} className="flex items-center gap-2">
                  <CalendarClock size={13} color={P.amber} style={{ flexShrink: 0 }} />
                  <span className="truncate" style={{ fontSize: 12.5, color: P.ink, flex: 1 }}>
                    {w.name} <span style={{ color: P.sub }}>№{w.occ}</span>
                  </span>
                  <span className="truncate" style={{ fontSize: 11.5, color: P.sub, maxWidth: 130 }}>
                    {w.violation}
                  </span>
                  <span className="ao-mono" style={{ fontSize: 11.5, color: w.daysLeft <= 3 ? P.brick : P.amber }}>
                    {w.daysLeft}d left
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Trend: case volume per week, last 8 weeks */}
      <Card
        title="Case volume — last 8 weeks"
        right={
          <span className="flex items-center gap-2">
            <Pill color={P.brick}>disciplinary</Pill>
            <Pill color={P.green}>leave</Pill>
          </span>
        }
      >
        <TrendBars weekly={weekly} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hours lost per account */}
        <Card title="Hours lost per account">
          {perAccount.every((p) => p.count === 0) ? (
            <Muted>Nothing logged for these accounts yet.</Muted>
          ) : (
            <div className="grid gap-3">
              {perAccount.map((p) => (
                <div key={p.a}>
                  <div className="flex items-center gap-2">
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: accColor(p.a), flexShrink: 0 }} />
                    <span className="ao-disp font-bold uppercase tracking-wide" style={{ fontSize: 12.5, color: P.ink }}>
                      {p.a}
                    </span>
                    <span className="flex-1" />
                    <span className="ao-mono font-semibold" style={{ fontSize: 13, color: P.brick }}>
                      {fmtMin(p.min)}
                    </span>
                  </div>
                  <div className="mt-1" style={{ background: P.mist, borderRadius: 4, height: 10, overflow: "hidden" }}>
                    <div className="ao-grow" style={{ width: `${(p.min / maxMin) * 100}%`, height: "100%", background: accColor(p.a) }} />
                  </div>
                  <div className="flex gap-3 mt-1" style={{ fontSize: 11, color: P.sub }}>
                    <span>{p.count} records</span>
                    <span style={{ color: p.disc ? P.brick : P.sub }}>{p.disc} disciplinary</span>
                    <span>{days(p.ded)} deducted</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Violation class distribution */}
        <Card title="Violation class distribution">
          <SeverityDonut tiers={bySeverity.tiers} leave={bySeverity.leave} total={live.length} />
        </Card>

        {/* Hours lost per LOB */}
        <Card title="Hours lost per line of business">
          {perLob.length === 0 ? (
            <Muted>No LOB data yet — RTA imports carry it; manual entries can set it on the log form.</Muted>
          ) : (
            <div className="grid gap-3">
              {perLob.map((p) => (
                <div key={p.lob}>
                  <div className="flex items-center gap-2">
                    <span className="ao-disp font-bold uppercase tracking-wide" style={{ fontSize: 12.5, color: p.lob === "Unassigned" ? P.sub : P.ink }}>
                      {p.lob}
                    </span>
                    <span className="flex-1" />
                    <span className="ao-mono font-semibold" style={{ fontSize: 13, color: P.brick }}>
                      {fmtMin(p.min)}
                    </span>
                  </div>
                  <div className="mt-1" style={{ background: P.mist, borderRadius: 4, height: 10, overflow: "hidden" }}>
                    <div className="ao-grow" style={{ width: `${(p.min / maxLob) * 100}%`, height: "100%", background: p.lob === "Unassigned" ? P.sub : P.petrol }} />
                  </div>
                  <div style={{ fontSize: 11, color: P.sub, marginTop: 2 }}>{p.count} records</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Breakdown by type */}
        <Card title="Breakdown by type">
          {byViolation.length === 0 ? (
            <Muted>Nothing logged yet.</Muted>
          ) : (
            <div className="grid gap-2">
              {byViolation.map((v) => (
                <div key={v.name} className="flex items-center gap-2">
                  <div className="truncate" style={{ width: 150, fontSize: 12.5, color: P.inkSoft, flexShrink: 0 }}>
                    {v.name}
                  </div>
                  <div className="flex-1" style={{ background: P.mist, borderRadius: 4, height: 14 }}>
                    <div
                      className="ao-grow"
                      style={{
                        width: `${(v.count / maxV) * 100}%`,
                        height: "100%",
                        borderRadius: 4,
                        background: v.sev ? sevColor(v.sev) : P.petrol,
                      }}
                    />
                  </div>
                  <div className="ao-mono" style={{ fontSize: 12.5, color: P.ink, width: 28, textAlign: "right" }}>
                    {v.count}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Per-violation trend — is each type improving after warnings? */}
        <Card title="Violation trend — last 8 weeks" right={<Pill color={P.sub}>per type</Pill>}>
          {violationTrends.length === 0 ? (
            <Muted>No cases in the last eight weeks to trend.</Muted>
          ) : (
            <div className="grid gap-2.5">
              {violationTrends.map((v) => (
                <VTrendRow key={v.name} v={v} />
              ))}
            </div>
          )}
        </Card>

        {/* Repeat offenders */}
        <Card title="Repeat cases — top agents">
          {offenders.length === 0 ? (
            <Muted>No disciplinary entries.</Muted>
          ) : (
            <div className="grid gap-2">
              {offenders.map((o) => (
                <div key={o.label} className="flex items-center gap-2">
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: accColor(o.account), flexShrink: 0 }} />
                  <span className="ao-mono truncate flex-1" style={{ fontSize: 12.5, color: P.ink }}>
                    {o.label}
                  </span>
                  {o.ded > 0 && (
                    <span
                      className="ao-mono inline-flex items-center gap-1"
                      style={{ fontSize: 11, color: P.sub }}
                      title="Total deduction days scheduled across all months"
                    >
                      <Scale size={10} />
                      {o.ded}d
                    </span>
                  )}
                  <Pill color={o.count >= 3 ? P.brick : P.amber} filled>
                    {o.count} case{o.count > 1 ? "s" : ""}
                  </Pill>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* One violation's 8-week trajectory: a sparkline, the total, and a direction
   badge comparing the recent four weeks with the prior four. Down is good —
   the warnings are working — so it reads green; up reads brick. */
function VTrendRow({ v }) {
  const improving = v.delta < 0;
  const worsening = v.delta > 0;
  const Arrow = improving ? TrendingDown : worsening ? TrendingUp : Minus;
  const tone = improving ? P.green : worsening ? P.brick : P.sub;
  const dot = v.sev ? sevColor(v.sev) : P.green;
  return (
    <div className="flex items-center gap-2">
      <span style={{ width: 8, height: 8, borderRadius: 2, background: dot, flexShrink: 0 }} />
      <span className="truncate" style={{ width: 130, fontSize: 12.5, color: P.inkSoft, flexShrink: 0 }}>
        {v.name}
      </span>
      <div className="flex-1 min-w-0">
        <Sparkline points={v.weeks} color={dot} />
      </div>
      <span
        className="ao-mono inline-flex items-center gap-0.5"
        style={{ fontSize: 11, color: tone, width: 52, justifyContent: "flex-end" }}
        title={`Prior 4 weeks: ${v.prior} · recent 4 weeks: ${v.recent}`}
      >
        <Arrow size={12} />
        {v.delta > 0 ? `+${v.delta}` : v.delta}
      </span>
      <span className="ao-mono" style={{ fontSize: 12.5, color: P.ink, width: 22, textAlign: "right" }}>
        {v.total}
      </span>
    </div>
  );
}

/* A minimal inline sparkline — one polyline plus a dot on the latest week.
   Pure SVG, sized to whatever width the flex row hands it. */
function Sparkline({ points, color }) {
  const W = 100;
  const H = 26;
  const pad = 3;
  const max = Math.max(1, ...points);
  const n = points.length;
  const x = (i) => pad + (i * (W - pad * 2)) / (n - 1);
  const y = (val) => H - pad - (val / max) * (H - pad * 2);
  const d = points.map((val, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 26, display: "block" }} role="img" aria-label="8-week trend">
      <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="var(--grid-line)" strokeWidth="1" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
      <circle cx={x(n - 1)} cy={y(points[n - 1])} r="2.2" fill={color} />
    </svg>
  );
}

/* Eight weeks of case volume as stacked bars — disciplinary below, leave on
   top — pure SVG, no chart library. Hours lost ride along in the label and
   tooltip so the lost-time signal isn't lost, but the bar answers "how many
   violations", which zero-minute cases (CSAT, attitude, …) need it to. */
function TrendBars({ weekly }) {
  const max = Math.max(1, ...weekly.map((w) => w.count));
  const W = 720;
  const H = 150;
  const pad = 8;
  const bw = (W - pad * 2) / weekly.length;

  if (weekly.every((w) => w.count === 0)) {
    return <Muted>No cases recorded in the last eight weeks.</Muted>;
  }

  return (
    /* minWidth: 0 is doing real work here, not tidying. A grid or flex child
       defaults to min-width: auto, which means it refuses to shrink below its
       content — so this scroller was widened to fit the 480px chart instead of
       scrolling it, and the whole page scrolled sideways on a phone. The
       overflow property was already right; the container simply could not get
       small enough to need it. */
    <div style={{ overflowX: "auto", minWidth: 0, maxWidth: "100%" }}>
      <svg viewBox={`0 0 ${W} ${H + 30}`} style={{ width: "100%", minWidth: 480 }} role="img" aria-label="Cases per week, last 8 weeks">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad} x2={W - pad} y1={H - H * f} y2={H - H * f} stroke="var(--deep-well)" strokeWidth="1" />
        ))}
        {weekly.map((w, i) => {
          const scale = (H - 16) / max;
          const discH = w.disc * scale;
          const leaveH = w.leave * scale;
          const x = pad + i * bw + bw * 0.18;
          const isCurrent = i === weekly.length - 1;
          const dim = isCurrent ? 1 : 0.45;
          const tip = `${fmtDate(w.start)} – ${fmtDate(w.end)}: ${w.count} case${w.count === 1 ? "" : "s"} (${w.disc} disciplinary, ${w.leave} leave) · ${fmtMin(w.min)} lost`;
          return (
            <g key={w.start}>
              {leaveH > 0 && (
                <rect x={x} y={H - discH - leaveH} width={bw * 0.64} height={leaveH} rx="3" fill={P.green} opacity={0.55 * dim + 0.25}>
                  <title>{tip}</title>
                </rect>
              )}
              {discH > 0 && (
                <rect x={x} y={H - discH} width={bw * 0.64} height={discH} rx="3" fill={P.brick} opacity={0.75 * dim + 0.25}>
                  <title>{tip}</title>
                </rect>
              )}
              {w.count > 0 && (
                <text x={x + bw * 0.32} y={H - discH - leaveH - 6} textAnchor="middle" className="ao-mono" style={{ fontSize: 11, fill: isCurrent ? "var(--hdr-strong)" : "var(--sub)" }}>
                  {w.count}
                </text>
              )}
              <text x={x + bw * 0.32} y={H + 18} textAnchor="middle" className="ao-mono" style={{ fontSize: 10, fill: "var(--sub)" }}>
                {fmtDate(w.end)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* Donut drawn by hand — one <circle> per tier, offset around the ring. */
function SeverityDonut({ tiers, leave, total }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const rows = [...tiers, { name: "Leave / excused", count: leave, color: P.green }].filter((t) => t.count > 0);
  const sum = rows.reduce((s, t) => s + t.count, 0);

  if (!sum) return <Muted>Nothing logged yet.</Muted>;

  let offset = 0;
  const arcs = rows.map((t) => {
    const len = (t.count / sum) * C;
    const arc = { ...t, len, offset };
    offset += len;
    return arc;
  });

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <svg width="132" height="132" viewBox="0 0 132 132" style={{ flexShrink: 0 }} role="img" aria-label="Violation class distribution">
        <g transform="rotate(-90 66 66)">
          <circle cx="66" cy="66" r={R} fill="none" stroke={P.mist} strokeWidth="16" />
          {arcs.map((a) => (
            <circle
              key={a.name}
              cx="66"
              cy="66"
              r={R}
              fill="none"
              stroke={a.color}
              strokeWidth="16"
              strokeDasharray={`${a.len} ${C - a.len}`}
              strokeDashoffset={-a.offset}
            />
          ))}
        </g>
        <text x="66" y="62" textAnchor="middle" className="ao-mono" style={{ fontSize: 22, fontWeight: 600, fill: P.ink }}>
          {total}
        </text>
        <text x="66" y="78" textAnchor="middle" className="ao-disp" style={{ fontSize: 10, letterSpacing: 1, fill: P.sub }}>
          CASES
        </text>
      </svg>

      <div className="grid gap-1.5 flex-1" style={{ minWidth: 140 }}>
        {arcs.map((a) => (
          <div key={a.name} className="flex items-center gap-2">
            <span style={{ width: 9, height: 9, borderRadius: 2, background: a.color, flexShrink: 0 }} />
            <span className="truncate" style={{ fontSize: 12.5, color: P.inkSoft, flex: 1 }}>
              {a.name}
            </span>
            <span className="ao-mono" style={{ fontSize: 12.5, color: P.ink }}>
              {a.count}
            </span>
            <span className="ao-mono" style={{ fontSize: 11, color: P.sub, width: 34, textAlign: "right" }}>
              {Math.round((a.count / sum) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

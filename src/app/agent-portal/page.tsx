/* The agent dashboard — read-only standing plus the digital acknowledgement
   inbox. All figures come from the same pure engine the staff app runs, fed
   from Prisma rows, so an agent and their PM always see identical numbers. */

import { redirect } from "next/navigation";
import { CalendarHeart, Clock3, Scale, ShieldAlert, CircleCheck, History } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { toEntry } from "@/lib/db";
import { getLocale } from "@/lib/locale";
import { GlassCard, GlassBadge, GlassStat, GlassProgress } from "@/components/glass";
import AckCenter from "@/components/portal/AckCenter";
// The shared rules engine — plain JS, identical to what the workspace uses.
import { agentSummary, agentTimeline } from "@/lib/agents.js";
import { statusOf } from "@/lib/engine.js";
import { fmtMin, fmtDate, fmtDateLong, days } from "@/lib/format.js";
import { addDays } from "@/lib/dates.js";
import { RESET_DAYS, EMERGENCY_QUOTA, PER_MONTH_CAP } from "@/lib/constants.js";

const SEV_TONE: Record<string, "neutral" | "amber" | "rose" | "violet"> = {
  Minor: "neutral",
  Moderate: "amber",
  Serious: "rose",
  "Zero Tolerance": "violet",
};

export default async function AgentPortalPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const me = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!me) redirect("/login");
  const locale = await getLocale();

  const rows = await prisma.case.findMany({
    where: {
      OR: [
        ...(me.empId ? [{ empId: { equals: me.empId, mode: "insensitive" as const } }] : []),
        { email: { equals: me.email, mode: "insensitive" as const } },
      ],
    },
  });

  const entries = rows.map(toEntry);
  const ref = { email: me.email, empId: me.empId || "" };
  const summary = agentSummary(entries, ref);
  const timeline = agentTimeline(entries, ref, RESET_DAYS);
  // agents.js builds this list with .filter(Boolean); TS can't see the nulls are gone.
  const activeWarnings = summary.activeWarnings as Array<{
    violation: string;
    severity: string;
    occ: number;
    action: string;
    resetOn: string;
    daysLeft: number;
  }>;
  const pendingAcks = entries
    .filter((e) => e.requiresAcknowledgement && !e.agentAcknowledgedAt && !e.voided)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return (
    <main className="grid gap-4">
      {/* Pending acknowledgements — the alert + signature flow */}
      <AckCenter
        locale={locale}
        pending={pendingAcks.map((e) => ({
          id: e.id as string,
          date: e.date as string,
          violation: e.violation as string,
          occurrence: (e.occurrence as number) ?? null,
          action: e.action as string,
          severity: (e.severity as string) ?? null,
          deductionApplied: (e.deductionApplied as number) || 0,
          investigation: e.severity === "Serious" || e.severity === "Zero Tolerance",
          appealState: (e.appealState as string) || "",
        }))}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <GlassStat
          label="Active warnings"
          value={activeWarnings.length}
          tone={activeWarnings.length ? "rose" : "emerald"}
          hint={activeWarnings.length ? "inside the 90-day window" : "all chains reset"}
        />
        <GlassStat
          label="Emergency leave"
          value={`${summary.emergency.used}/${EMERGENCY_QUOTA}`}
          tone={summary.emergency.used >= EMERGENCY_QUOTA ? "rose" : summary.emergency.used >= EMERGENCY_QUOTA - 1 ? "amber" : "neutral"}
          hint="days used this year"
        />
        <GlassStat
          label="Deducted this month"
          value={`${summary.monthDeduction}/${PER_MONTH_CAP}`}
          tone={summary.monthDeduction >= PER_MONTH_CAP ? "amber" : "neutral"}
          hint="statutory monthly cap"
        />
        <GlassStat label="Hours lost (90d)" value={fmtMin(summary.hoursLost)} tone={summary.hoursLost ? "amber" : "emerald"} />
      </div>

      {/* Quota bars */}
      <div className="grid gap-3 lg:grid-cols-2">
        <GlassCard title="Emergency leave quota">
          <div className="flex items-center gap-3">
            <CalendarHeart size={16} className="shrink-0 text-emerald-300" />
            <div className="flex-1">
              <GlassProgress
                value={summary.emergency.used}
                max={EMERGENCY_QUOTA}
                tone={summary.emergency.used >= EMERGENCY_QUOTA ? "rose" : summary.emergency.used >= EMERGENCY_QUOTA - 1 ? "amber" : "emerald"}
              />
            </div>
            <span className="font-mono text-sm text-slate-300">
              {summary.emergency.used} / {EMERGENCY_QUOTA}
            </span>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
            {EMERGENCY_QUOTA} days per year, max 2 consecutive per month. Beyond the quota, unplanned leave is recorded
            as unauthorised absence and runs through the disciplinary matrix.
          </p>
        </GlassCard>

        <GlassCard title="Salary deduction headroom">
          <div className="flex items-center gap-3">
            <Scale size={16} className="shrink-0 text-emerald-300" />
            <div className="flex-1">
              <GlassProgress
                value={summary.monthDeduction}
                max={PER_MONTH_CAP}
                tone={summary.monthDeduction >= PER_MONTH_CAP ? "rose" : summary.monthDeduction >= 3 ? "amber" : "emerald"}
              />
            </div>
            <span className="font-mono text-sm text-slate-300">
              {summary.monthDeduction} / {PER_MONTH_CAP} days
            </span>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
            Egyptian Labour Law No. 12/2003 (am. 14/2025): deductions are capped at 5 days per incident and 5 days per
            calendar month, whatever the matrix prescribes.
          </p>
        </GlassCard>
      </div>

      {/* Active warnings with reset countdowns */}
      <GlassCard
        title="Active warning stages"
        right={
          activeWarnings.length ? (
            <GlassBadge tone="rose">{activeWarnings.length} live</GlassBadge>
          ) : (
            <GlassBadge tone="emerald">
              <CircleCheck size={11} />
              Clear
            </GlassBadge>
          )
        }
      >
        {activeWarnings.length === 0 ? (
          <p className="text-[13px] text-slate-400">
            No active warnings — every earlier chain has passed its {RESET_DAYS}-day reset.
          </p>
        ) : (
          <div className="grid gap-3">
            {activeWarnings.map(
              (w) => (
                <div key={w.violation} className="rounded-xl border border-white/10 bg-white/5 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <GlassBadge tone={SEV_TONE[w.severity] || "neutral"}>{w.severity}</GlassBadge>
                    <span className="text-[13.5px] font-medium text-slate-200">{w.violation}</span>
                    <GlassBadge tone="neutral">№{w.occ}</GlassBadge>
                    <span className="flex-1" />
                    <span className="font-mono text-[11.5px] text-slate-400">
                      resets {fmtDateLong(w.resetOn)}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-slate-400">{w.action}</div>
                  <div className="mt-2.5 flex items-center gap-3">
                    <div className="flex-1">
                      <GlassProgress value={RESET_DAYS - w.daysLeft} max={RESET_DAYS} tone={w.daysLeft <= 14 ? "emerald" : "amber"} />
                    </div>
                    <span className="whitespace-nowrap font-mono text-[11px] text-slate-400">{days(w.daysLeft)} left</span>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </GlassCard>

      {/* 90-day timeline */}
      <GlassCard
        title={`${RESET_DAYS}-day case timeline`}
        right={
          <GlassBadge tone="neutral">
            <History size={11} />
            {timeline.length} entr{timeline.length === 1 ? "y" : "ies"}
          </GlassBadge>
        }
      >
        {timeline.length === 0 ? (
          <p className="text-[13px] text-slate-400">No cases in the last {RESET_DAYS} days.</p>
        ) : (
          <div className="relative pl-5">
            <div className="absolute bottom-1 left-[5px] top-1 w-px bg-white/10" />
            <div className="grid gap-4">
              {timeline.map((e: Record<string, unknown>) => {
                const sev = (e.severity as string) || "";
                const dismissed = e.stage === "dismissed";
                const dot = dismissed
                  ? "bg-slate-500"
                  : sev === "Zero Tolerance"
                    ? "bg-violet-400"
                    : sev === "Serious"
                      ? "bg-rose-400"
                      : sev === "Moderate"
                        ? "bg-amber-400"
                        : sev === "Minor"
                          ? "bg-slate-300"
                          : "bg-emerald-400";
                return (
                  <div key={e.id as string} className={dismissed ? "opacity-50" : ""}>
                    <span className={`absolute left-0 mt-1.5 h-[11px] w-[11px] rounded-full ring-4 ring-slate-900/60 ${dot}`} />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold text-slate-200">{fmtDateLong(e.date)}</span>
                      <GlassBadge tone={dismissed ? "neutral" : SEV_TONE[sev] || "emerald"}>
                        {e.violation as string}
                        {e.occurrence ? ` · №${e.occurrence}` : ""}
                      </GlassBadge>
                      <GlassBadge tone="neutral">{statusOf(e)}</GlassBadge>
                      {(e.missingMin as number) > 0 && (
                        <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-rose-300">
                          <Clock3 size={10} />−{fmtMin(e.missingMin)}
                        </span>
                      )}
                      {e.agentAcknowledgedAt ? (
                        <GlassBadge tone="emerald">
                          <CircleCheck size={10} />
                          Signed
                        </GlassBadge>
                      ) : e.requiresAcknowledgement ? (
                        <GlassBadge tone="amber">Awaiting your signature</GlassBadge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-[12.5px] text-slate-400">
                      {dismissed ? (
                        "Dismissed at triage — excluded from occurrence counts and deductions."
                      ) : (
                        <>
                          <span className="text-slate-300">{e.action as string}</span>
                          {(e.deductionApplied as number) > 0 && <> · {days(e.deductionApplied)} deducted</>}
                          {e.disciplinary && e.stage === "active" ? <> · warning resets {fmtDate(addDays(e.date, RESET_DAYS))}</> : null}
                        </>
                      )}
                    </div>
                    {(sev === "Serious" || sev === "Zero Tolerance") && !dismissed && (
                      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-rose-300">
                        <ShieldAlert size={11} />
                        Investigation rights: 3–5 working days written response, colleague may be present.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </GlassCard>
    </main>
  );
}

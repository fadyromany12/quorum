/* GET /api/wfm/plan?account=&lob=&date=&interval=30
   The whole planning picture for one queue on one day, in one request.

   Deliberately one endpoint rather than four. A staffing plan is only meaningful
   as a set — forecast, requirement, roster, coverage — and a client that
   assembles it from four calls will eventually render a requirement computed
   from one day's forecast against another day's roster, which is a bug nobody
   can see. One request, one consistent read.

   Nothing here is stored. The requirement is recomputed on every read from the
   forecast rows and the current settings, because a stored requirement is a
   number that silently stops matching its inputs the moment a target changes. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { visibilityScope } from "@/lib/employee-db";
import { planDay, coverage, shrinkageFrom, explain, checkForecast, DEFAULT_INTERVAL, INTERVAL_MINUTES } from "@/lib/wfm.js";
import { scheduledByInterval, shrinkageInputs, findClashes } from "@/lib/schedule.js";

/** Defaults a BPO inbound queue is usually run to. Overridable per request so a
    planner can ask "what would 90/15 cost me" without saving anything. */
const DEFAULTS = { targetSeconds: 20, targetServiceLevel: 0.8, maxOccupancy: 0.85, ahtSeconds: 300 };

/* `Number(null)` is 0, not NaN — so a helper that only checks isFinite turns
   every omitted parameter into zero. Here that meant an absent
   targetServiceLevel became 0, which checkForecast correctly rejected as
   impossible, and the whole plan came back empty with a message about a target
   nobody had set. Absence is checked before conversion. */
const num = (v: string | null, fallback: number) => {
  if (v === null || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("wfmRead");
  const q = new URL(req.url).searchParams;

  const date = q.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GuardError(400, "A date (YYYY-MM-DD) is required.");
  const account = q.get("account") ?? "";
  if (!account) throw new GuardError(400, "An account is required — a plan spans one queue.");
  const lob = q.get("lob") ?? "";

  const intervalMinutes = INTERVAL_MINUTES.includes(num(q.get("interval"), DEFAULT_INTERVAL))
    ? num(q.get("interval"), DEFAULT_INTERVAL)
    : DEFAULT_INTERVAL;
  const opts = {
    intervalMinutes,
    targetSeconds: num(q.get("targetSeconds"), DEFAULTS.targetSeconds),
    targetServiceLevel: num(q.get("targetServiceLevel"), DEFAULTS.targetServiceLevel),
    maxOccupancy: num(q.get("maxOccupancy"), DEFAULTS.maxOccupancy),
    ahtSeconds: DEFAULTS.ahtSeconds,
  };

  const forecast = await prisma.forecast.findMany({
    where: { account, lob, date },
    orderBy: { interval: "asc" },
  });

  /* The roster is scoped the same way the directory is: a lead planning their
     own team must not learn the whole floor's shift pattern through this
     endpoint. `null` scope means unrestricted. */
  const scope = await visibilityScope(actor);
  const roster = await prisma.scheduleEntry.findMany({
    where: {
      date,
      ...(scope ? { employeeId: { in: scope } } : {}),
      employee: { account, ...(lob ? { lob } : {}) },
    },
    include: { pattern: { select: { paidBreakMinutes: true, unpaidBreakMinutes: true } } },
  });

  /* Break minutes live on the pattern, but the entry's own copy wins where it
     has one — the entry is the promise, the pattern is only where it came from. */
  const rows = roster.map((r) => ({
    ...r,
    paidBreakMinutes: r.pattern?.paidBreakMinutes ?? 0,
    unpaidBreakMinutes: r.pattern?.unpaidBreakMinutes ?? 0,
  }));

  /* Shrinkage is measured from this day's own roster. A day with no roster
     yields 0, which is honest: there is nothing to measure yet, and inventing
     "we usually run 30%" here would put a guess inside a derived number. */
  const shrink = shrinkageFrom(shrinkageInputs(rows));
  const override = q.get("shrinkage");
  const shrinkage = override === null ? shrink.shrinkage : Math.min(0.95, Math.max(0, Number(override) || 0));

  const problems = checkForecast(forecast, opts);
  const plan = problems.length ? [] : planDay(forecast, { ...opts, shrinkage });
  const scheduled = scheduledByInterval(rows, intervalMinutes);
  const cov = coverage(plan, scheduled);

  return NextResponse.json({
    date,
    account,
    lob,
    settings: { ...opts, shrinkage },
    forecast,
    problems,
    plan,
    /* The working for the busiest interval, so the screen can show why without
       the client re-implementing any of the mathematics. */
    explanation: plan.length
      ? explain(forecast.reduce((a, b) => (b.contacts > a.contacts ? b : a), forecast[0]), { ...opts, shrinkage }).lines
      : [],
    scheduled,
    coverage: cov,
    shrinkageDerived: shrink,
    rosterCount: rows.length,
    clashes: findClashes(rows).length,
  });
});

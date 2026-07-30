/* GET /api/cron/daily — the scheduled sweep, one idempotent pass.

   Everything here is safe to run twice (or after a week of not running):
   accruals converge on the schedule, stale logouts stamp the deadline rather
   than the sweep time, and timeout defaults only touch requests still pending.

   Guarded by CRON_SECRET rather than a session: Vercel Cron sends the header,
   and an unauthenticated sweep endpoint would let anyone on the internet fire
   escalation email at will. */

import { NextResponse } from "next/server";
import { sweepAccruals } from "@/lib/leave-db";
import { sweepStaleSessions } from "@/lib/attendance-db";
import { sweepAutoResolve, overdue } from "@/lib/workflow-db";
import { prisma } from "@/lib/prisma";
import { sendEmail, simpleHtml } from "@/lib/notify";

export const GET = async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization");
  if (!secret || got !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [accruals, sessions, resolved] = await Promise.all([
    sweepAccruals(),
    sweepStaleSessions(),
    sweepAutoResolve(),
  ]);

  /* Escalations: one mail per breached request, to whoever it waits on.
     Errors are swallowed per-recipient — a bad address must not stop the rest. */
  const breached = await overdue();
  let mailed = 0;
  for (const e of breached) {
    if (!e.sla) continue; // escalations() only returns breaches, but the type cannot see that
    const waiting = e.sla.waitingOn ?? [];
    const approvers = await prisma.employee.findMany({
      where: { id: { in: waiting } },
      select: { workEmail: true, fullNameEn: true },
    });
    for (const a of approvers) {
      if (!a.workEmail) continue;
      const r = await sendEmail(
        a.workEmail,
        `Overdue: ${e.request.config?.label ?? e.request.type} for ${e.request.subject?.fullNameEn ?? "an employee"}`,
        simpleHtml("A request is past its target", [
          `${e.request.config?.label ?? e.request.type} raised on ${e.request.raisedOn}.`,
          `It has waited ${e.sla.waitedDays} days — ${e.sla.overdueBy} past the ${e.sla.slaDays}-day target.`,
        ]),
      );
      if (!r.skipped) mailed++;
    }
  }

  return NextResponse.json({
    accruals, sessions: sessions.swept, autoResolved: resolved.resolved,
    escalations: breached.length, mailed,
  });
};

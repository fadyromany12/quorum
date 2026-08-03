/* GET /api/cron/daily — the scheduled sweep, one idempotent pass.

   Everything here is safe to run twice (or after a week of not running):
   accruals converge on the schedule, stale logouts stamp the deadline rather
   than the sweep time, and timeout defaults only touch requests still pending.

   Guarded by CRON_SECRET rather than a session: Vercel Cron sends the header,
   and an unauthenticated sweep endpoint would let anyone on the internet fire
   escalation email at will. */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sweepAccruals } from "@/lib/leave-db";
import { sweepStaleSessions } from "@/lib/attendance-db";
import { sweepAutoResolve, overdue } from "@/lib/workflow-db";
import { prisma } from "@/lib/prisma";
import { sendEmail, simpleHtml } from "@/lib/notify";

/* Compared byte-for-byte in constant time. A `!==` on a bearer token leaks its
   prefix through timing, and this endpoint is reachable by anyone who can guess
   the URL — the whole secret is the only thing standing there. Length is
   compared first because timingSafeEqual throws on a mismatch, and length is
   not the part worth hiding. */
function secretMatches(header: string | null, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const got = header ?? "";
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export const GET = async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  // Fail closed: no configured secret means no sweep, not an open sweep.
  if (!secret || !secretMatches(req.headers.get("authorization"), secret)) {
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

  /* One lookup for every approver across every breach, rather than one per
     breach. This runs on a serverless function with a time budget and talks to
     Neon over the network — a query per row is how a sweep that works with ten
     overdue requests times out at two hundred. */
  const allWaiting = [...new Set(breached.flatMap((e) => e.sla?.waitingOn ?? []))];
  const approverRows = allWaiting.length
    ? await prisma.employee.findMany({
        where: { id: { in: allWaiting } },
        select: { id: true, workEmail: true, fullNameEn: true },
      })
    : [];
  const byId = new Map(approverRows.map((a) => [a.id, a]));

  let mailed = 0;
  for (const e of breached) {
    if (!e.sla) continue; // escalations() only returns breaches, but the type cannot see that
    const approvers = (e.sla.waitingOn ?? []).map((id) => byId.get(id)).filter((a) => a != null);
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

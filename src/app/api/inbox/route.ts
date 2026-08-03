/* GET /api/inbox — what is waiting on this person, right now.

   Assembled from the same tables the screens read, on every request. Nothing is
   stored, so nothing can disagree with the screen it links to: approve the last
   request and the count is zero on the next load, without anything having to
   remember to delete a row. See lib/inbox.js for why that trade is the right
   way round here.

   Deliberately counts rather than records. The bell says how many and where;
   the screen renders the detail. Shipping the records too would put a second,
   thinner copy of every list behind a dropdown, and the two would disagree the
   first time one of them was filtered differently. */

import { NextResponse } from "next/server";
import { requireRole, guarded } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/auth.js";
import { buildInbox } from "@/lib/inbox.js";
import { completeness } from "@/lib/profile-policy.js";
import { inbox } from "@/lib/workflow-db";

export const GET = guarded(async () => {
  const actor = await requireRole(null);
  const sources: Record<string, { count: number; detail?: string }> = {};

  /* The person's employment record — the approvals inbox is keyed on employee
     id, not user id, and delegation means the set of people acting for an
     approver is computed rather than stored on the step. */
  const employee = await prisma.employee.findUnique({
    where: { userId: actor.id },
    include: { pii: true },
  });

  /* Approvals waiting on this actor, counted by calling the very function the
     approvals screen renders from. Re-deriving it here with a leaner query
     would be faster and would eventually disagree — delegation alone means a
     step's approverId is not the only person it can be waiting on, and a bell
     that quietly ignores delegated work is worse than no bell for whoever is
     covering. Same source, same answer, by construction. */
  if (employee) {
    const waiting = await inbox(employee.id);
    if (waiting.length) sources.approval = { count: waiting.length };
  }

  // Cases this role would triage.
  if (can(actor, "triage")) {
    const review = await prisma.case.count({ where: { stage: "review", voided: false } });
    if (review) sources.review = { count: review };
  }

  /* Case sign-offs — the queues the "My approvals" screen actually renders.
     The conditions are copied from the same predicates that screen filters on:
     ops sees escalated-and-notified cases it has not confirmed, HR sees the
     ones ops has already passed. */
  let signoff = 0;
  if (can(actor, "ops")) {
    signoff += await prisma.case.count({
      where: { voided: false, stage: "active", notified: true, opsConfirmed: false },
    });
  }
  if (can(actor, "hr")) {
    signoff += await prisma.case.count({
      where: { voided: false, stage: "active", hrNeeded: true, hrConfirmed: false, opsConfirmed: true },
    });
  }
  if (signoff) sources.signoff = { count: signoff };

  const me = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { email: true, empId: true },
  });
  if (me) {
    /* Anything this person has to sign. Matched the way the portal matches —
       by employee id or email, since either identifies them. */
    const unsigned = await prisma.case.count({
      where: {
        voided: false,
        requiresAcknowledgement: true,
        agentAcknowledgedAt: null,
        OR: [
          ...(me.empId ? [{ empId: { equals: me.empId, mode: "insensitive" as const } }] : []),
          { email: { equals: me.email, mode: "insensitive" as const } },
        ],
      },
    });
    if (unsigned) sources.acknowledgement = { count: unsigned };

    /* Their own record — only the gaps that genuinely stop payroll. A bell that
       nags about a missing LinkedIn URL is a bell people learn to ignore, and
       an ignored bell is worse than no bell because the real one is in it. */
    if (employee) {
      const { pii, ...rest } = employee;
      const c = completeness(rest, pii) as { missing: Array<{ label: string; blocking: boolean }> };
      const blocking = c.missing.filter((m) => m.blocking);
      if (blocking.length) {
        sources.incomplete = { count: blocking.length, detail: blocking.map((m) => m.label).join(", ") };
      }
    }
  }

  return NextResponse.json(buildInbox(sources));
});

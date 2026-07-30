/* GET   /api/me/profile — my record, my identifiers, and what is missing.
   PATCH /api/me/profile — edit it, tier by tier.

   Reading your own identifiers needs no piiRead: that permission gates other
   people's data, and an employee checking their own bank details is the normal
   case, not an exception. Writes are partitioned by the policy — self fields
   apply at once and are audited; verified fields become a profileChange
   request through the approval engine; HR-held fields are refused with the
   dispute route named. One PATCH can carry a mixture, and the response says
   exactly what happened to each part. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";
import { raiseRequest } from "@/lib/workflow-db";
import { partitionEdit, completeness, FIELD_POLICY } from "@/lib/profile-policy.js";

const NO_RECORD = "Your login is not linked to an employment record yet — HR can link it.";

async function mine(userId?: string) {
  if (!userId) return null;
  return prisma.employee.findUnique({
    where: { userId },
    include: { pii: true },
  });
}

export const GET = guarded(async () => {
  const actor = await requireRole(null);
  const me = await mine(actor.id);
  if (!me) throw new GuardError(409, NO_RECORD);

  const { pii, ...employee } = me;
  return NextResponse.json({
    employee,
    pii: pii ?? null,
    completeness: completeness(employee, pii),
    policy: FIELD_POLICY,
  });
});

export const PATCH = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const me = await mine(actor.id);
  if (!me) throw new GuardError(409, NO_RECORD);

  const body = await req.json().catch(() => ({}));
  const fields = (body.fields ?? {}) as Record<string, unknown>;
  if (!Object.keys(fields).length) throw new GuardError(400, "Nothing to change.");

  const { self, verified, refused } = partitionEdit(fields);

  // Apply the immediate tier.
  let applied: string[] = [];
  if (self.length) {
    const emp: Record<string, string> = {};
    const pii: Record<string, string> = {};
    for (const f of self) {
      const target = FIELD_POLICY[f].entity === "pii" ? pii : emp;
      target[f] = String(fields[f] ?? "").trim();
    }
    if (Object.keys(emp).length) {
      await prisma.employee.update({ where: { id: me.id }, data: emp });
    }
    if (Object.keys(pii).length) {
      await prisma.employeePII.upsert({
        where: { employeeId: me.id },
        create: { employeeId: me.id, ...pii },
        update: pii,
      });
    }
    applied = self;
    await writeAudit({
      actor,
      action: "PROFILE_SELF_EDITED",
      // Field names only, never values — an audit row quoting a phone number
      // is a second copy of it.
      summary: `${me.fullNameEn} updated their own details: ${self.map((f) => FIELD_POLICY[f].label).join(", ")}.`,
      meta: { employeeId: me.id, fields: self },
    });
  }

  // Route the verified tier through the approval engine.
  let request = null;
  if (verified.length) {
    const proposal: Record<string, unknown> = {};
    for (const f of verified) proposal[f] = fields[f];
    const result = await raiseRequest(
      {
        type: "profileChange",
        subjectId: me.id,
        // Prisma's InputJsonValue rejects Record<string, unknown>; the shape is
        // plain JSON by construction, so assert it once at the boundary.
        payload: { fields: proposal, labels: verified.map((f) => FIELD_POLICY[f].label) } as never,
      },
      { ...actor, employeeId: me.id },
    );
    if (!result.ok) throw new GuardError(result.status, result.reason);
    request = result.request;
  }

  const fresh = await mine(actor.id);
  const { pii, ...employee } = fresh!;
  return NextResponse.json({
    applied,
    pendingVerification: verified,
    refused,
    request,
    employee,
    pii: pii ?? null,
    completeness: completeness(employee, pii),
  });
});

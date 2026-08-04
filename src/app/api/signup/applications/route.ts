/* GET /api/signup/applications — the people waiting on you.

   No permission is required beyond being signed in, because the answer is
   narrowed by who you are rather than by what your role is: a lead sees the
   applications addressed to them, HR and the Super Admin see all of them, and
   everyone else sees an empty list. Gating this on a role would leave a lead
   with an application nobody can act on. */

import { NextResponse } from "next/server";
import { requireRole, guarded } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { listApplications } from "@/lib/signup-db";

export const GET = guarded(async () => {
  const actor = await requireRole(null);
  const employee = await prisma.employee.findUnique({
    where: { userId: actor.id },
    select: { id: true },
  });

  return NextResponse.json({
    applications: await listApplications({ role: actor.role, employeeId: employee?.id ?? null }),
  });
});

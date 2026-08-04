/* POST /api/admin/reset — factory reset (SuperAdmin). Wipes every table and
   reseeds the demo baseline. The one sanctioned exception to AuditLog
   immutability, and it logs itself as the first row of the new history.

   Gated twice on purpose: being a Super Admin says you are allowed to do this
   somewhere, and the environment flag says this is the deployment you meant.
   Preview builds point at the production database and are publicly reachable,
   so the role check alone would make a branch URL a delete button. */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { seedAll } from "@/lib/seed-core.mjs";
import { factoryResetGate } from "@/lib/destructive.js";

/* Whether the button would work, so the Danger zone can say "switched off on
   preview" instead of offering a reset that fails after the confirm dialog.
   Admin-only for the same reason the POST checks the role first: the shape of
   a deployment's configuration is not public. */
export const GET = guarded(async () => {
  await requireRole("admin");
  const gate = factoryResetGate(process.env as Record<string, string | undefined>);
  return NextResponse.json(gate);
});

export const POST = guarded(async () => {
  const actor = await requireRole("admin");

  // Checked after the role, so an unauthenticated caller learns nothing about
  // how this deployment is configured.
  const gate = factoryResetGate(process.env as Record<string, string | undefined>);
  if (!gate.allowed) throw new GuardError(403, gate.reason);

  const result = await seedAll(prisma, { actorName: actor.name, actorRole: actor.role });
  // Seeded users carry fresh ids — every existing session is now orphaned and
  // the client must sign in again.
  return NextResponse.json({ ok: true, ...result });
});

/* PUT /api/config — the org structure and team-lead list. SuperAdmin only.

   Accounts now carry their own lines of business. The column is Json and was
   holding a flat array of names, so both shapes are accepted on the way in and
   the current one is always written out — no migration, nothing to backfill. */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { checkAccounts } from "@/lib/org.js";

export const PUT = guarded(async (req: Request) => {
  const actor = await requireRole("admin");
  const body = await req.json().catch(() => ({}));
  const check = checkAccounts(body.accounts);
  if (!check.ok) throw new GuardError(400, check.reason);
  const accounts = check.accounts;
  const tls: string[] = Array.isArray(body.tls) ? body.tls.map(String) : [];

  await prisma.appConfig.upsert({
    where: { id: 1 },
    create: { id: 1, accounts, tls },
    update: { accounts, tls },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: "CONFIG_UPDATED",
      summary: `Config updated — ${accounts.length} accounts, ${accounts.reduce((n, a) => n + a.lobs.length, 0)} lines of business, ${tls.length} TLs.`,
    },
  });

  return NextResponse.json({ accounts, tls });
});

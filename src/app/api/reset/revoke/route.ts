/* POST /api/reset/revoke — kill every live code for an account, now.

   For the call that starts "someone rang me about a password code I never
   asked for". That call is the earliest signal of an attempted takeover, and
   the person taking it needs to be able to act on it themselves — so this is
   as wide as issuing a code rather than narrower. An IT desk that has to find
   a Super Admin at 2am does nothing, and the code stays live for its full
   twenty minutes.

   Deliberately not a delete. The row stays, marked revoked with a reason, and
   the audit line records who killed it and why — a revocation is often the
   first entry in an incident timeline, and a table that tidied itself up would
   erase the moment the attempt was noticed. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole("revokeReset");
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const note = String(body.note ?? "").slice(0, 300);
  if (!email) throw new GuardError(400, "An email address is required.");

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true } });
  if (!user) throw new GuardError(404, "No account with that address.");

  const { count } = await prisma.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "admin" },
  });

  await writeAudit({
    actor,
    action: "RESET_REVOKED",
    summary: `${actor.name} revoked ${count} live recovery code${count === 1 ? "" : "s"} for ${user.email}${note ? ` — ${note}` : ""}`,
    meta: { userId: user.id, revoked: count, note },
  });

  return NextResponse.json({
    ok: true,
    revoked: count,
    message:
      count === 0
        ? "There were no live codes for that account. Nothing was outstanding."
        : `${count} code${count === 1 ? "" : "s"} killed. Any code already read out will no longer work.`,
  });
});

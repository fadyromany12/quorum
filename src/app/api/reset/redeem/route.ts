/* POST /api/reset/redeem — spend a code and set a new password.

   Unauthenticated by necessity: the whole point is that the person cannot sign
   in. The code is the only credential, which is why it is short-lived,
   single-use, attempt-limited and revoked by any newer request.

   The password arrives here and is hashed here. It is never logged, never put
   in an audit summary, never returned. The audit row records that a recovery
   was completed and by which code — not what was chosen. */

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";
import { hashPassword } from "@/lib/passwords";
import { passwordProblem } from "@/lib/auth.js";
import { normaliseCode, redeemable, checkRedemption, MAX_ATTEMPTS } from "@/lib/reset.js";

const hashCode = (code: string) => createHash("sha256").update(normaliseCode(code)).digest("hex");

/** One sentence for every failure past the shape check. Which of the six
    reasons it was lives in the audit log, not in the response. */
const REFUSED = "That code is not valid. Ask for a new one.";

export const POST = guarded(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "");
  const password = String(body.password ?? "");

  /* Shape first, so a malformed submission costs no lookup and — more
     importantly — burns no attempt on a code that might be someone else's. */
  const problems = checkRedemption({ code, password }, passwordProblem);
  if (problems.length) throw new GuardError(400, problems.join(" "));
  if (!email) throw new GuardError(400, "Your email address is required.");

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true } });
  if (!user) throw new GuardError(400, REFUSED);

  /* Newest first: a person who asked twice will be holding the second code, and
     the first was revoked when the second was issued. */
  const request = await prisma.passwordReset.findFirst({
    where: { userId: user.id, codeHash: hashCode(code) },
    orderBy: { createdAt: "desc" },
  });

  /* A wrong code still counts against the live request, so guessing costs
     attempts rather than being free. Without this, only correct-but-stale
     codes would ever be counted, which is the opposite of what is wanted. */
  if (!request) {
    const live = await prisma.passwordReset.findFirst({
      where: { userId: user.id, usedAt: null, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (live) {
      await prisma.passwordReset.update({ where: { id: live.id }, data: { attempts: { increment: 1 } } });
      await writeAudit({
        actor: { name: user.email, role: "anonymous" },
        action: "RESET_FAILED",
        summary: `Wrong recovery code for ${user.email} (attempt ${live.attempts + 1} of ${MAX_ATTEMPTS})`,
        meta: { userId: user.id, requestId: live.id, reason: "wrong code" },
      });
    }
    throw new GuardError(400, REFUSED);
  }

  const check = redeemable(request);
  if (!check.ok) {
    await writeAudit({
      actor: { name: user.email, role: "anonymous" },
      action: "RESET_FAILED",
      summary: `Recovery code refused for ${user.email} — ${check.reason}`,
      meta: { userId: user.id, requestId: request.id, reason: check.reason },
    });
    throw new GuardError(400, check.publicMessage);
  }

  /* One transaction: the code is spent and the password changes together, so a
     failure cannot leave a code that has been used but changed nothing, or a
     password changed by a code still valid for a second use. */
  await prisma.$transaction([
    prisma.passwordReset.update({ where: { id: request.id }, data: { usedAt: new Date() } }),
    /* Every other live code for this account dies too. */
    prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "used" },
    }),
    prisma.user.update({
      where: { id: user.id },
      /* mustChange stays false: they have just chosen this password themselves,
         so demanding another change at sign-in would be theatre. */
      data: { passHash: hashPassword(password), mustChange: false },
    }),
    /* Any failed-login history is cleared — the account was recovered, and a
       lockout from before the recovery would lock them out of the password
       they just set. */
    prisma.loginAttempt.deleteMany({ where: { email: user.email } }),
  ]);

  await writeAudit({
    actor: { name: user.email, role: "anonymous" },
    action: "RESET_COMPLETED",
    summary: `${user.email} set a new password with a recovery code issued ${request.issuedByName ? `by ${request.issuedByName}` : "on request"}`,
    meta: {
      userId: user.id,
      requestId: request.id,
      delivery: request.delivery,
      issuedByName: request.issuedByName,
      minutesToRedeem: Math.round((Date.now() - request.createdAt.getTime()) / 60000),
    },
  });

  return NextResponse.json({ ok: true, message: "Your password is set. Sign in with it now." });
});

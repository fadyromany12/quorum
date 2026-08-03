/* POST /api/reset/issue — start an account recovery.

   Two callers, one record:

     · An IT desk, authenticated, issuing a code for someone standing in front
       of them. The code comes back in the response for IT to read aloud.
     · The locked-out person themselves, unauthenticated, from the sign-in
       screen. The code never comes back in the response; it is delivered, and
       the response is the same sentence regardless of whether the account
       exists.

   The unauthenticated path answers identically for a real and an unknown
   address, and identically again when rate limited. An endpoint that says "no
   such account" is a free tool for testing a leaked address list against this
   company, and one that says "too many attempts" for real accounts only is the
   same tool with an extra step.

   What is never returned, logged, or stored anywhere: a password. The code
   proves someone asked for a recovery; the password is chosen at redemption by
   the person themselves. */

import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";
import { auth } from "@/auth";
import { can } from "@/lib/auth.js";
import { makeCode, normaliseCode, mayRequest, RESET_ACK, deliveryFor, CODE_TTL_MINUTES } from "@/lib/reset.js";

const hashCode = (code: string) => createHash("sha256").update(normaliseCode(code)).digest("hex");

/** Delivery mode. Until a mailbox is confirmed to work, IT-issued is the mode
    that functions for everyone — an agent locked out of the only company
    account they have cannot receive an email at it. */
const MODE = process.env.RESET_DELIVERY === "email" ? "email" : "itIssued";

export const POST = guarded(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const session = await auth();
  const actor = session?.user;
  const byIt = !!actor && can({ role: actor.role }, "issueReset");

  if (!email) throw new GuardError(400, "An email address is required.");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true },
  });

  /* An unknown address takes the same path and the same time as a known one,
     as far as the caller can tell. IT gets a real answer, because IT is
     authenticated and is looking at the person. */
  if (!user) {
    if (byIt) throw new GuardError(404, "No account with that address.");
    return NextResponse.json({ ok: true, message: RESET_ACK, delivery: deliveryFor(MODE).instruction });
  }

  const recent = await prisma.passwordReset.findMany({
    where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 3600_000) } },
    select: { createdAt: true },
  });
  const allowed = mayRequest(recent);
  if (!allowed.ok) {
    await writeAudit({
      actor: byIt ? { id: actor!.id, name: actor!.name ?? "", role: actor!.role } : { name: "self-serve", role: "anonymous" },
      action: "RESET_THROTTLED",
      summary: `Reset request for ${user.email} refused — ${allowed.reason}`,
      meta: { userId: user.id, reason: allowed.reason },
    });
    /* Same shape and sentence as success. IT is told plainly, because IT can
       see the person and needs to know why nothing is happening. */
    if (byIt) throw new GuardError(429, `Too many recent requests for this account (${allowed.reason}). Wait, or ask a Super Admin.`);
    return NextResponse.json({ ok: true, message: allowed.publicMessage, delivery: deliveryFor(MODE).instruction });
  }

  /* Any live code is revoked first. Two valid codes for one account doubles the
     guessing surface and makes "which one did you read them" unanswerable. */
  await prisma.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "newRequest" },
  });

  const code = makeCode((n) => new Uint8Array(randomBytes(n)));
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      codeHash: hashCode(code),
      delivery: byIt ? "itIssued" : MODE,
      issuedByName: byIt ? actor!.name ?? "" : "",
      issuedByRole: byIt ? actor!.role : "",
      requestedIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
    },
  });

  await writeAudit({
    actor: byIt ? { id: actor!.id, name: actor!.name ?? "", role: actor!.role } : { name: "self-serve", role: "anonymous" },
    action: "RESET_ISSUED",
    summary: byIt
      ? `${actor!.name} issued a recovery code for ${user.email}`
      : `${user.email} requested a recovery code`,
    meta: { userId: user.id, delivery: byIt ? "itIssued" : MODE, ttlMinutes: CODE_TTL_MINUTES },
  });

  /* The code returns only to an authenticated IT desk, to be read aloud. On the
     self-serve path it must reach the person through the delivery channel and
     never through this response — returning it here would let anyone who can
     name an address take over the account. */
  if (byIt) {
    return NextResponse.json({
      ok: true,
      code,
      expiresInMinutes: CODE_TTL_MINUTES,
      user: { name: user.name, email: user.email, role: user.role },
      instruction: deliveryFor("itIssued").itAction,
    });
  }

  /* Email delivery is not wired yet — deliberately. Rather than pretend, the
     response says the code was not sent, while still not revealing whether the
     account exists: this branch is only reachable when RESET_DELIVERY=email,
     which is opt-in configuration nobody has turned on. */
  return NextResponse.json({
    ok: true,
    message: RESET_ACK,
    delivery: deliveryFor(MODE).instruction,
  });
});

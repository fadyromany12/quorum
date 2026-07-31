/* GET /api/health — what protections are actually switched on.

   "We encrypt PII" and "we encrypt PII when someone remembered to set the
   variable" are different claims, and only one of them is checkable. This
   endpoint makes the second one impossible to hold by accident: an operator can
   see, at a glance, that the key is loaded, the mailer is wired and the sweep
   can run.

   Admin-only, and it reports whether each secret is *present*, never what it
   is — a health endpoint that echoes configuration is a configuration leak. */

import { NextResponse } from "next/server";
import { requireRole, guarded } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { encryptionStatus, ENCRYPTED_PII_FIELDS, isEncrypted } from "@/lib/pii-crypto.js";

export const GET = guarded(async () => {
  await requireRole("admin");

  const enc = encryptionStatus();

  /* How much of the estate is actually encrypted. Without this the health check
     answers "is the key set", which is not the question — a key set last week
     over a table written to for a year leaves most rows in the clear until each
     one is next saved. Sampling answers the real question. */
  const sample = await prisma.employeePII.findMany({
    take: 200,
    select: Object.fromEntries(ENCRYPTED_PII_FIELDS.map((f) => [f, true])),
  });
  let withValues = 0;
  let encrypted = 0;
  for (const row of sample) {
    for (const f of ENCRYPTED_PII_FIELDS) {
      const v = (row as Record<string, string>)[f];
      if (!v) continue;
      withValues++;
      if (isEncrypted(v)) encrypted++;
    }
  }

  /* "Not set" is accurate and unhelpful on its own. The overwhelmingly common
     cause is not a missing variable but a variable saved after the last build:
     hosts bake the environment in at build time, so saving one changes nothing
     until something rebuilds. Saying so here turns a dead end into a next step.

     Only shown when the variable is absent entirely — if it is present but
     malformed, the length is the problem and a rebuild will not fix it. */
  const notSet = !enc.active && /not set/i.test(enc.problem ?? "");
  const hint = notSet
    ? "Set in the host but still missing here? The environment is baked in at build time — redeploy so a new build picks it up, and check the variable applies to this environment."
    : null;

  return NextResponse.json({
    piiEncryption: {
      active: enc.active,
      problem: enc.problem,
      hint,
      fields: ENCRYPTED_PII_FIELDS,
      // "0 of 0" is the honest answer for an empty table, not "100%".
      storedValues: withValues,
      encryptedValues: encrypted,
      pctEncrypted: withValues ? Math.round((encrypted / withValues) * 100) : null,
      note: withValues > encrypted
        ? "Values written before encryption was switched on stay readable until each record is next saved."
        : null,
    },
    // Same reasoning as the hint above: these two fail the same way, for the
    // same reason, and a bare `false` sends the reader looking in the wrong place.
    email: { configured: !!process.env.RESEND_API_KEY, hint: process.env.RESEND_API_KEY ? null : hint },
    scheduledJobs: { configured: !!process.env.CRON_SECRET, hint: process.env.CRON_SECRET ? null : hint },
  });
});

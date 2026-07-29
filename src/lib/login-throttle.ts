/* DB-backed login throttle — the fleet-wide counterpart to the in-memory
   limiter in rate-limit.js. State lives in the LoginAttempt table, so the
   sliding window holds across serverless instances and restarts, not just
   within one warm process. Same window and ceiling as the pure algorithm.

   Every call is best-effort: a database hiccup must never lock a legitimate
   user out (status fails open) nor block a login (record/clear are swallowed). */

import { prisma } from "./prisma";
import { MAX_ATTEMPTS, WINDOW_MS } from "./rate-limit.js";

export async function loginStatus(email: string): Promise<{ blocked: boolean; remaining: number; retryAfterMs: number }> {
  try {
    const since = new Date(Date.now() - WINDOW_MS);
    const rows = await prisma.loginAttempt.findMany({
      where: { email, at: { gte: since } },
      orderBy: { at: "asc" },
      select: { at: true },
    });
    const blocked = rows.length >= MAX_ATTEMPTS;
    const retryAfterMs = blocked ? Math.max(0, WINDOW_MS - (Date.now() - rows[0].at.getTime())) : 0;
    return { blocked, remaining: Math.max(0, MAX_ATTEMPTS - rows.length), retryAfterMs };
  } catch {
    return { blocked: false, remaining: MAX_ATTEMPTS, retryAfterMs: 0 }; // fail open
  }
}

export async function recordLoginFailure(email: string): Promise<void> {
  try {
    await prisma.loginAttempt.create({ data: { email } });
    // Opportunistically prune this email's expired rows so the table self-cleans.
    await prisma.loginAttempt.deleteMany({ where: { email, at: { lt: new Date(Date.now() - WINDOW_MS) } } });
  } catch {
    /* best-effort */
  }
}

export async function clearLoginFailures(email: string): Promise<void> {
  try {
    await prisma.loginAttempt.deleteMany({ where: { email } });
  } catch {
    /* best-effort */
  }
}

/* Web Push delivery.

   Chosen over email deliberately. Email is switched off in this deployment
   until somebody wires a provider, and the thing that actually reaches a lead
   standing on a floor is a phone notification, not an inbox they open twice a
   day. Web Push needs no provider account, no domain reputation and no
   per-message cost — a keypair in the environment and the browser does the
   rest.

   ── Fail-open, always ─────────────────────────────────────────────────────

   Every function here swallows its own errors. A push service outage must
   never fail the request that triggered it: approving leave has to work when
   Google's push endpoint is down, and an approval that 500s because a
   notification could not be delivered is a far worse bug than a notification
   nobody received. Nothing in this file throws, and nothing awaits delivery on
   the critical path where it can be avoided.

   ── Dead subscriptions are deleted, not retried ───────────────────────────

   404 and 410 from a push service mean the browser threw the subscription
   away — the user cleared site data, reinstalled, or revoked permission. There
   is nothing to retry and retrying forever is how a table becomes a graveyard
   that slows every send. Anything else is transient and counted instead, so a
   permanently broken endpoint still leaves eventually. */

import webpush from "web-push";
import { prisma } from "./prisma";
import { messageFor, shouldNotify, readPrefs } from "./notifications.js";

/** Set once, lazily — reading env at module load breaks the build step. */
let configured: boolean | null = null;

export function pushReady() {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  try {
    /* The subject identifies the sender to the push service and must be a
       mailto: or https: URL. It is contact information, not authentication —
       nothing is sent to it. */
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hr@konecta.com", publicKey, privateKey);
    configured = true;
  } catch {
    configured = false;
  }
  return configured;
}

export const publicKey = () => process.env.VAPID_PUBLIC_KEY ?? "";

/** Why push is not working, in words an operator can act on. */
export function pushStatus() {
  if (pushReady()) return { ready: true, reason: "" };
  return {
    ready: false,
    reason:
      "Push is not configured. Generate a keypair with `npm run push:keys` and set VAPID_PUBLIC_KEY, " +
      "VAPID_PRIVATE_KEY and VAPID_SUBJECT on the deployment — then redeploy, because the environment " +
      "is baked in at build time.",
  };
}

export async function saveSubscription(
  userId: string,
  sub: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } },
  label = "",
) {
  const endpoint = String(sub?.endpoint ?? "");
  const p256dh = String(sub?.keys?.p256dh ?? "");
  const auth = String(sub?.keys?.auth ?? "");
  if (!endpoint || !p256dh || !auth) return { ok: false as const, reason: "That is not a usable push subscription." };

  /* Upsert on the endpoint rather than the user: the same browser
     re-subscribing must update its keys in place, and the same person on two
     devices must end up with two rows. */
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh, auth, label: label.slice(0, 80) },
    update: { userId, p256dh, auth, failures: 0, label: label.slice(0, 80) },
  });
  return { ok: true as const };
}

export async function removeSubscription(endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

/** How many devices this person would be reached on. */
export const deviceCount = (userId: string) => prisma.pushSubscription.count({ where: { userId } });

const MAX_FAILURES = 5;

/**
 * Send one event to one person, on every device they have registered.
 *
 * Returns a summary rather than throwing, so callers can log it and move on.
 * `at` is the local time used for the quiet-hours check and is passed in
 * rather than read here — a server in UTC has no business deciding what
 * counts as night for somebody in Cairo.
 */
export async function notifyUser(
  userId: string,
  kind: string,
  data: Record<string, unknown> = {},
  { at = "" }: { at?: string } = {},
) {
  try {
    if (!pushReady()) return { sent: 0, skipped: "not configured" };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notifyPrefs: true, active: true },
    });
    if (!user?.active) return { sent: 0, skipped: "inactive account" };

    const decision = shouldNotify(kind, readPrefs(user.notifyPrefs), { at });
    if (!decision.send) return { sent: 0, skipped: decision.reason };

    const subs = await prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (!subs.length) return { sent: 0, skipped: "no devices registered" };

    const payload = JSON.stringify(messageFor(kind, data));
    let sent = 0;

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { urgency: (messageFor(kind, data).urgency === "low" ? "low" : "high") as never, TTL: 60 * 60 * 12 },
          );
          sent++;
          await prisma.pushSubscription.update({
            where: { id: s.id },
            data: { failures: 0, lastSentAt: new Date() },
          });
        } catch (err) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            // The browser threw this subscription away. Nothing to retry.
            await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          } else {
            const row = await prisma.pushSubscription
              .update({ where: { id: s.id }, data: { failures: { increment: 1 } }, select: { failures: true } })
              .catch(() => null);
            if (row && row.failures >= MAX_FAILURES) {
              await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
            }
          }
        }
      }),
    );

    return { sent, skipped: sent ? "" : "every device failed" };
  } catch (err) {
    console.error("[push] notifyUser failed:", err);
    return { sent: 0, skipped: "error" };
  }
}

/**
 * Notify the person behind an employment record.
 *
 * Most callers hold an employee id, not a user id, and an employee without a
 * login is a normal state rather than an error — an applicant has no account
 * and cannot be pushed to.
 */
export async function notifyEmployee(
  employeeId: string,
  kind: string,
  data: Record<string, unknown> = {},
  opts: { at?: string } = {},
) {
  try {
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
    if (!emp?.userId) return { sent: 0, skipped: "no login" };
    return await notifyUser(emp.userId, kind, data, opts);
  } catch {
    return { sent: 0, skipped: "error" };
  }
}

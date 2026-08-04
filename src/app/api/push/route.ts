/* GET    /api/push  — the public key, my devices, and my preferences.
   POST   /api/push  — register this browser, or save preferences, or send a test.
   DELETE /api/push  — forget this browser.

   One route because they are one conversation: a browser asks what it needs to
   subscribe, subscribes, and manages what it will be interrupted for. Splitting
   that across four files would mean four places that have to agree about the
   shape of a subscription. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { publicKey, pushStatus, saveSubscription, removeSubscription, notifyUser } from "@/lib/push-db";
import { readPrefs, NOTIFY_KINDS, OPTIONAL_KINDS, isNotifyKind, isRequired } from "@/lib/notifications.js";

export const GET = guarded(async () => {
  const actor = await requireRole(null);
  const [user, devices] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.id }, select: { notifyPrefs: true } }),
    prisma.pushSubscription.findMany({
      where: { userId: actor.id },
      select: { id: true, endpoint: true, label: true, createdAt: true, lastSentAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const status = pushStatus();
  return NextResponse.json({
    ...status,
    publicKey: status.ready ? publicKey() : "",
    prefs: readPrefs(user?.notifyPrefs),
    kinds: NOTIFY_KINDS,
    optional: OPTIONAL_KINDS,
    devices: devices.map((d) => ({
      ...d,
      // The endpoint is a long opaque URL and a device identifier; the browser
      // needs it to recognise its own row, nobody needs to read it.
      endpoint: d.endpoint,
      createdAt: d.createdAt.toISOString(),
      lastSentAt: d.lastSentAt?.toISOString() ?? null,
    })),
  });
});

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const body = await req.json().catch(() => ({}));

  if (body.action === "prefs") {
    const incoming = body.prefs ?? {};
    /* Required kinds cannot be muted, and the filter happens here as well as in
       readPrefs — a preference that looks saved and is not is worse than one
       that is refused, so the stored row never contains a mute we would ignore. */
    const muted = Array.isArray(incoming.muted)
      ? incoming.muted.filter((k: unknown) => isNotifyKind(k) && !isRequired(k as string))
      : [];
    const prefs = readPrefs({ ...incoming, muted });
    await prisma.user.update({ where: { id: actor.id }, data: { notifyPrefs: prefs } });
    return NextResponse.json({ ok: true, prefs });
  }

  if (body.action === "test") {
    /* A test that silently does nothing is how somebody concludes push is
       broken when it is only unconfigured, so the reason comes back. */
    const result = await notifyUser(actor.id, "requestDecided", {
      decision: "approved",
      summary: "This is a test notification. Push is working on this device.",
      id: "test",
    });
    return NextResponse.json({ ok: result.sent > 0, ...result });
  }

  const status = pushStatus();
  if (!status.ready) throw new GuardError(503, status.reason);

  const saved = await saveSubscription(actor.id, body.subscription, String(body.label ?? ""));
  if (!saved.ok) throw new GuardError(400, saved.reason);
  return NextResponse.json({ ok: true });
});

export const DELETE = guarded(async (req: Request) => {
  await requireRole(null);
  const endpoint = new URL(req.url).searchParams.get("endpoint") ?? "";
  if (!endpoint) throw new GuardError(400, "Which device?");
  /* Deleting by endpoint rather than by id and owner: the endpoint is already
     unique and a browser unsubscribing knows its own endpoint and nothing else.
     Worst case somebody deletes a subscription they hold the endpoint for,
     which is their own. */
  await removeSubscription(endpoint);
  return NextResponse.json({ ok: true });
});

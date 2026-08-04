"use client";

/* Turning notifications on, and controlling what they are for.

   Permission is asked for on a click and never on load. A browser that
   prompts the moment a page opens gets refused by most people and then cannot
   ask again — the permission is sticky, so a badly-timed prompt is not a
   missed opportunity, it is a permanent one. So the button explains what will
   happen first, and the prompt comes after somebody has said yes to the idea.

   The device list is here for a reason people hit immediately: a subscription
   belongs to a browser, not a person. Somebody who signed in on a shared floor
   machine has a notification following them around a computer they no longer
   sit at, and needs to be able to see it and remove it. */

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Send, Trash2, Moon } from "lucide-react";
import { Card, Muted, Pill, BtnGhost, BtnPrimary, TInput, Field, Toggle } from "./ui/index.jsx";
import { P, alpha } from "../lib/tokens.js";

/* The push service wants the VAPID key as bytes, and hands it to us as
   base64url. Neither `atob` nor the browser will do the conversion. */
function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const deviceLabel = () => {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Device";
  const browser = /Edg/.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "browser";
  return `${browser} on ${os}`;
};

export default function NotificationSettings() {
  const [state, setState] = useState(null);
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

  const load = useCallback(async () => {
    const res = await fetch("/api/push");
    const j = await res.json().catch(() => ({}));
    if (res.ok) setState(j);
    if (supported) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        setEndpoint(sub?.endpoint ?? "");
      } catch {
        /* No registration yet is the normal first-visit state, not an error. */
      }
    }
  }, [supported]);
  useEffect(() => { load(); }, [load]);

  const enable = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!state?.ready) throw new Error(state?.reason || "Push is not configured on this deployment.");

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        /* Worth spelling out, because the browser will not ask twice and the
           person has no idea where the setting went. */
        throw new Error(
          permission === "denied"
            ? "Your browser is blocking notifications for this site. You will have to allow them in the site settings — the browser will not ask again."
            : "Notifications were not allowed.",
        );
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.publicKey),
      });

      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), label: deviceLabel() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not register this device.");

      setNotice("This device will now be notified.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const forget = async (ep) => {
    setBusy(true);
    try {
      await fetch(`/api/push?endpoint=${encodeURIComponent(ep)}`, { method: "DELETE" });
      if (ep === endpoint) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        await sub?.unsubscribe().catch(() => {});
        setEndpoint("");
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const savePrefs = async (patch) => {
    const prefs = { ...state.prefs, ...patch };
    setState((s) => ({ ...s, prefs }));
    await fetch("/api/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "prefs", prefs }),
    });
  };

  const test = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const j = await res.json().catch(() => ({}));
      setNotice(j.ok ? "Sent — it should appear in a second." : `Nothing was sent: ${j.skipped || "unknown reason"}.`);
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <Card title={<span className="inline-flex items-center gap-2"><Bell size={14} />Notifications</span>}>
        <Muted>Loading…</Muted>
      </Card>
    );
  }

  const here = state.devices.some((d) => d.endpoint === endpoint);
  const prefs = state.prefs;

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><Bell size={14} />Notifications</span>}
      right={
        here
          ? <Pill color={P.green} filled><Bell size={11} />On here</Pill>
          : <Pill color={P.sub}><BellOff size={11} />Off here</Pill>
      }
    >
      <Muted>
        The app already knows what is waiting on you. This is what makes it tell you — on your phone, without
        the app open.
      </Muted>

      {!supported ? (
        <div className="mt-3" style={{ fontSize: 12.5, color: P.amber }}>
          This browser cannot receive push notifications. On an iPhone you have to add the app to your home screen
          first — Safari only allows notifications for installed apps.
        </div>
      ) : !state.ready ? (
        <div
          className="mt-3 p-3"
          style={{ background: "var(--wash)", border: `1px solid ${alpha(P.ink, 0.12)}`, borderRadius: 8, fontSize: 12.5, color: P.inkSoft }}
        >
          {state.reason}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!here && <BtnPrimary icon={Bell} onClick={enable} disabled={busy}>{busy ? "…" : "Notify this device"}</BtnPrimary>}
          {here && <BtnGhost icon={Send} onClick={test} disabled={busy}>Send a test</BtnGhost>}
        </div>
      )}

      {error && (
        <div className="mt-3 p-3" role="alert" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-3 p-3" role="status" style={{ background: P.greenWash, border: `1px solid ${alpha(P.green, 0.4)}`, borderRadius: 8, fontSize: 13 }}>
          {notice}
        </div>
      )}

      {/* Devices. A subscription belongs to a browser, so somebody who signed
          in on a shared floor machine needs to see it and remove it. */}
      {state.devices.length > 0 && (
        <div className="mt-3">
          <div className="ao-disp uppercase" style={{ fontSize: 10.5, letterSpacing: 0.5, color: P.sub }}>
            Devices
          </div>
          <div className="mt-1 grid gap-1">
            {state.devices.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-2" style={{ fontSize: 12.5 }}>
                <span>{d.label || "A browser"}</span>
                {d.endpoint === endpoint && <Pill color={P.petrol}>this one</Pill>}
                <span style={{ color: P.sub }}>added {d.createdAt.slice(0, 10)}</span>
                <span className="flex-1" />
                <BtnGhost color={P.brick} icon={Trash2} onClick={() => forget(d.endpoint)} disabled={busy}>
                  Forget
                </BtnGhost>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What to be interrupted for. */}
      <div className="mt-4">
        <div className="ao-disp uppercase" style={{ fontSize: 10.5, letterSpacing: 0.5, color: P.sub }}>
          What to tell me about
        </div>
        <div className="mt-2 grid gap-1.5">
          {Object.entries(state.kinds).map(([kind, meta]) => (
            <div key={kind} className="flex flex-wrap items-center gap-2">
              <Toggle
                on={meta.required || !prefs.muted.includes(kind)}
                disabledLook={meta.required}
                label={meta.label}
                title={
                  meta.required
                    ? "This one cannot be switched off — somebody else is blocked until you act, and a queue that silently stops moving is worse than an interruption."
                    : undefined
                }
                onClick={() => {
                  if (meta.required) return;
                  const muted = prefs.muted.includes(kind)
                    ? prefs.muted.filter((k) => k !== kind)
                    : [...prefs.muted, kind];
                  savePrefs({ muted });
                }}
              />
              {meta.required && <Pill color={P.sub}>always</Pill>}
            </div>
          ))}
        </div>
      </div>

      {/* Quiet hours. */}
      <div className="mt-4">
        <div className="ao-disp uppercase flex items-center gap-1.5" style={{ fontSize: 10.5, letterSpacing: 0.5, color: P.sub }}>
          <Moon size={11} />Quiet hours
        </div>
        <Muted>
          Set these to when you sleep, not to the night — a night-shift agent is asleep at two in the afternoon.
          Requests waiting on your decision still come through; nothing else does.
        </Muted>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="From">
            <TInput type="time" value={prefs.quietFrom} onChange={(e) => savePrefs({ quietFrom: e.target.value })} />
          </Field>
          <Field label="Until">
            <TInput type="time" value={prefs.quietTo} onChange={(e) => savePrefs({ quietTo: e.target.value })} />
          </Field>
        </div>
      </div>
    </Card>
  );
}

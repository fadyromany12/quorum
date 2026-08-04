"use client";

/* Thanking somebody.

   The only screen in this product that records something good. Everything else
   an agent sees here is a violation, a deduction, a lapse or a request — an
   accurate picture of what workforce software is for, and the reason nobody
   opens one voluntarily.

   No score, no leaderboard, no total. A number gets gamed within a month and
   then divided by tenure in a performance review, at which point thanking a
   colleague has become an assessed activity and nobody does it sincerely
   again. What is shown is who, for what, and in whose words. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Heart, Send } from "lucide-react";
import { Card, Muted, Pill, BtnPrimary, BtnGhost, TArea, TSelect, Field } from "./ui/index.jsx";
import { P, alpha } from "../lib/tokens.js";
import { checkRecognition } from "../lib/recognition.js";

export default function Recognition() {
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ toId: "", value: "", note: "", visibility: "team" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [r, d] = await Promise.all([fetch("/api/recognition"), fetch("/api/directory")]);
    if (r.ok) setData(await r.json());
    if (d.ok) setPeople((await d.json()).people ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const check = useMemo(
    () => checkRecognition(form, { fromId: data?.me }),
    [form, data],
  );

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/recognition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "That did not work.");
      setForm({ toId: "", value: "", note: "", visibility: "team" });
      setOpen(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <Card title={<span className="inline-flex items-center gap-2"><Heart size={14} />Thanks</span>}>
        <Muted>Loading…</Muted>
      </Card>
    );
  }

  const { wall, values, visibilities, received } = data;

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><Heart size={14} />Thanks</span>}
      right={
        <div className="flex flex-wrap items-center gap-2">
          {/* A count and who from, never a score. "Six, from five people" and
              "six, all from your own manager" are different facts. */}
          {received.count > 0 && (
            <Pill color={P.green}>
              {received.count} for you{received.givers > 1 ? `, from ${received.givers}` : ""}
            </Pill>
          )}
          {!open && <BtnGhost icon={Heart} onClick={() => setOpen(true)}>Thank someone</BtnGhost>}
        </div>
      }
    >
      {open && (
        <div className="p-3 mb-3" style={{ border: `1px solid ${alpha(P.ink, 0.14)}`, borderRadius: 9 }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Who">
              <TSelect value={form.toId} onChange={(e) => setForm((f) => ({ ...f, toId: e.target.value }))}>
                <option value="">Choose…</option>
                {people.filter((x) => x.id !== data.me).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}{x.jobTitle ? ` — ${x.jobTitle}` : ""}</option>
                ))}
              </TSelect>
            </Field>
            <Field label="What for">
              <TSelect value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}>
                <option value="">Choose…</option>
                {Object.entries(values).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </TSelect>
            </Field>
          </div>

          <div className="mt-2">
            <Field label="What they did">
              <TArea
                rows={3}
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Took my Friday night shift at two hours' notice."
              />
            </Field>
          </div>

          {/* Some thanks are for something private — covering while somebody was
              unwell. A wall with one setting either exposes that or silences it. */}
          <div className="mt-2">
            <Field label="Who sees it">
              <TSelect value={form.visibility} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value }))}>
                {Object.entries(visibilities).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </TSelect>
            </Field>
          </div>

          {check.problems.length > 0 && form.note.length > 0 && (
            <div className="mt-2" style={{ fontSize: 12.5, color: P.amber }}>{check.problems[0]}</div>
          )}
          {error && <div className="mt-2" role="alert" style={{ fontSize: 12.5, color: P.brick }}>{error}</div>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <BtnPrimary icon={Send} onClick={send} disabled={check.problems.length > 0 || busy}>
              {busy ? "Sending…" : "Send it"}
            </BtnPrimary>
            <BtnGhost onClick={() => { setOpen(false); setError(""); }}>Cancel</BtnGhost>
          </div>
        </div>
      )}

      {wall.length === 0 ? (
        <Muted>Nothing here yet. Be the first.</Muted>
      ) : (
        <div className="grid gap-1.5">
          {wall.map((r) => (
            <div key={r.id} className="p-2.5" style={{ border: `1px solid ${alpha(P.ink, 0.1)}`, borderRadius: 8 }}>
              <div className="flex flex-wrap items-baseline gap-x-1.5" style={{ fontSize: 12.5 }}>
                <strong>{r.fromName}</strong>
                <span style={{ color: P.sub }}>thanked</span>
                <strong>{r.toName}</strong>
                <Pill color={P.green}>{values[r.value]?.label ?? r.value}</Pill>
                <span className="flex-1" />
                <span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>{r.createdAt.slice(0, 10)}</span>
              </div>
              {/* The whole value of the row. */}
              <div className="mt-1" style={{ fontSize: 13, color: P.inkSoft }}>{r.note}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

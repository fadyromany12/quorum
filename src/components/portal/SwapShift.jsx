"use client";

/* Ask to swap a shift with a colleague.

   Today this happens on WhatsApp and reaches the roster, if at all, as a favour
   someone remembers to type in. The cost is not the typing: it is that the
   coverage model, the exceptions screen and payroll are all working from a
   roster that is quietly wrong, and the agent who did the covering has no
   record of it.

   The lead approves, because coverage is theirs to answer for — a swap can be
   perfectly fine for the two people involved and leave Thursday afternoon two
   short. The colleague's agreement is a precondition the requester confirms
   here, not a second approval step: modelling it as one would park a request on
   an agent who has no queue, no SLA and no reason to look at it. */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Send } from "lucide-react";
import { Card, Muted, BtnPrimary, TSelect, Field } from "../ui/index.jsx";
import { P, alpha } from "../../lib/tokens.js";
import { fmtDate } from "../../lib/format.js";

const describe = (r) =>
  `${fmtDate(r.date)} · ${r.startTime || "—"} · ${Math.round((r.durationMinutes || 0) / 60)}h`;

export default function SwapShift() {
  const [mine, setMine] = useState([]);
  const [theirs, setTheirs] = useState([]);
  const [mineId, setMineId] = useState("");
  const [theirsId, setTheirsId] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/schedule/swappable");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not load the roster.");
      setMine(j.mine ?? []);
      setTheirs(j.theirs ?? []);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "shiftSwap", payload: { mineId, theirsId, agreed: true } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The swap was refused.");
      setNotice("Sent to your team leader. Nothing on the roster changes until they approve it.");
      setMineId("");
      setTheirsId("");
      setAgreed(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  /* Nothing published to swap. Says so plainly rather than showing two empty
     dropdowns, which reads as broken rather than as "not yet". */
  if (!mine.length) {
    return (
      <Card title={<span className="inline-flex items-center gap-2"><ArrowLeftRight size={14} />Swap a shift</span>}>
        <Muted>{error || "You have no published shifts coming up to swap."}</Muted>
      </Card>
    );
  }

  return (
    <Card title={<span className="inline-flex items-center gap-2"><ArrowLeftRight size={14} />Swap a shift</span>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your shift">
          <TSelect value={mineId} onChange={(e) => setMineId(e.target.value)}>
            <option value="">Choose one of yours…</option>
            {mine.map((r) => <option key={r.id} value={r.id}>{describe(r)}</option>)}
          </TSelect>
        </Field>
        <Field label="Theirs">
          <TSelect value={theirsId} onChange={(e) => setTheirsId(e.target.value)}>
            <option value="">Choose a colleague&rsquo;s…</option>
            {theirs.map((r) => (
              <option key={r.id} value={r.id}>{r.employeeName} — {describe(r)}</option>
            ))}
          </TSelect>
        </Field>
      </div>

      <label className="mt-3 flex items-start gap-2" style={{ fontSize: 12.5, color: P.inkSoft, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>
          I have already agreed this with them. Your lead will see that you said so — raising a swap
          your colleague has not agreed to is a conversation nobody wants to have twice.
        </span>
      </label>

      {error && (
        <div className="mt-3 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 13 }} role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-3 p-3" style={{ background: P.greenWash, border: `1px solid ${alpha(P.green, 0.4)}`, borderRadius: 8, fontSize: 13 }} role="status">
          {notice}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <BtnPrimary icon={Send} onClick={submit} disabled={busy || !mineId || !theirsId || !agreed}>
          {busy ? "Sending…" : "Ask my lead"}
        </BtnPrimary>
        <Muted>The roster does not move until your lead approves.</Muted>
      </div>
    </Card>
  );
}

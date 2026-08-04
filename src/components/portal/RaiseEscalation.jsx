"use client";

/* Raising something above your manager — including about them.

   Every other route in this app is addressed to the person you report to,
   which is right for almost everything and catastrophic for the one case where
   that person is the problem. There was no path at all: somebody underpaid,
   worked past their hours or treated badly by their own lead could raise it
   with exactly one person, their lead.

   The panel is deliberately quiet — collapsed until asked for, no badge, no
   colour. A prominent "report your manager" button on a portal somebody opens
   on the floor is a button nobody presses. */

import { useMemo, useState } from "react";
import { ShieldAlert, Send, Lock } from "lucide-react";
import { Card, Muted, BtnPrimary, BtnGhost, TArea, TSelect, Field } from "../ui/index.jsx";
import { P, alpha } from "../../lib/tokens.js";
import { ESCALATION_CATEGORIES, checkEscalation, goesStraightToHr } from "../../lib/escalation.js";

export default function RaiseEscalation() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const check = useMemo(() => checkEscalation({ category, detail }), [category, detail]);
  const meta = ESCALATION_CATEGORIES[category] ?? null;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "escalation", payload: { category, detail } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "That did not work.");
      setDone(
        goesStraightToHr(category)
          ? "Raised with HR. It has not gone through anybody in your reporting line."
          : "Raised with your manager's manager. Your own manager has not been told and will not see it.",
      );
      setCategory("");
      setDetail("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Card title={<span className="inline-flex items-center gap-2"><ShieldAlert size={14} />Raise something</span>}>
        <div className="p-3" role="status" style={{ background: P.greenWash, border: `1px solid ${alpha(P.green, 0.4)}`, borderRadius: 8, fontSize: 13 }}>
          {done}
        </div>
      </Card>
    );
  }

  return (
    <Card title={<span className="inline-flex items-center gap-2"><ShieldAlert size={14} />Raise something</span>}>
      <Muted>
        For anything you cannot take to your own manager — including something about them. It goes to their
        manager, or straight to HR.
      </Muted>

      {!open ? (
        <div className="mt-3">
          <BtnGhost onClick={() => setOpen(true)}>Raise something</BtnGhost>
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-3">
            <Field label="What is this about">
              <TSelect value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Choose…</option>
                {Object.entries(ESCALATION_CATEGORIES).map(([c, m]) => (
                  <option key={c} value={c}>{m.label}</option>
                ))}
              </TSelect>
            </Field>

            {/* Who reads it, before they type. Somebody deciding whether to
                raise a grievance needs to know where it lands first — finding
                out afterwards is exactly the fear that stops people. */}
            {meta && (
              <div
                className="p-3"
                style={{
                  background: meta.hrOnly ? P.amberWash : "var(--well)",
                  border: `1px solid ${alpha(meta.hrOnly ? P.amber : P.ink, meta.hrOnly ? 0.4 : 0.12)}`,
                  borderRadius: 8,
                  fontSize: 12.5,
                }}
              >
                {meta.blurb && <div style={{ color: P.inkSoft }}>{meta.blurb}</div>}
                <div className="inline-flex items-center gap-1.5 mt-1" style={{ color: meta.hrOnly ? P.amber : P.petrol }}>
                  <Lock size={11} />
                  {meta.hrOnly
                    ? "This goes to HR directly. Nobody in your reporting line sees it."
                    : "This goes to your manager's manager. Your own manager is not told."}
                </div>
              </div>
            )}

            <Field label="What happened">
              <TArea
                rows={5}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="Enough that somebody can look into it without having to ask your manager about it."
              />
            </Field>
          </div>

          {/* The honest version of the thing people ask for. */}
          <Muted>
            This cannot be anonymous — it names you so that somebody can actually investigate it. It is
            confidential instead: your manager is not told, is not in the audience, and it does not appear
            in any list they can open.
          </Muted>

          {check.problems.length > 0 && detail.length > 0 && (
            <div className="mt-2" style={{ fontSize: 12.5, color: P.amber }}>{check.problems[0]}</div>
          )}
          {error && (
            <div className="mt-3 p-3" role="alert" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 13 }}>
              {error}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <BtnPrimary icon={Send} onClick={submit} disabled={check.problems.length > 0 || busy}>
              {busy ? "Sending…" : "Send it"}
            </BtnPrimary>
            <BtnGhost onClick={() => { setOpen(false); setError(""); }}>Cancel</BtnGhost>
          </div>
        </>
      )}
    </Card>
  );
}

/* Tab C — the triage gate.

   Nothing is punitive until a human says so. A case sits here until a manager
   assigns it, writes a real comment, and either escalates or dismisses it. */

import { useState } from "react";
import { ShieldCheck, ArrowUpRight, Archive } from "lucide-react";
import { Field, TSelect, TArea, Label, BtnPrimary, BtnGhost } from "./ui/index.jsx";
import { P, alpha } from "../lib/tokens.js";

export const MIN_COMMENT = 15;

export default function ReviewBox({ e, tls, onDecide }) {
  const [by, setBy] = useState(e.tl || tls[0] || "");
  const [assignee, setAssignee] = useState(e.assignee || e.tl || "");
  const [comment, setComment] = useState("");

  const text = comment.trim();
  const short = text.length < MIN_COMMENT;
  const canDismiss = !short;
  const canEscalate = !short && !!assignee;

  const why = short
    ? `${MIN_COMMENT - text.length} more character${MIN_COMMENT - text.length === 1 ? "" : "s"} of context needed`
    : !assignee
      ? "Assign an investigating manager first"
      : "";

  return (
    <div className="mt-3 p-3" style={{ background: P.signalWash, border: `1px dashed ${alpha(P.petrol, 0.4)}`, borderRadius: 8 }}>
      <div className="ao-disp uppercase tracking-wide font-semibold flex items-center gap-1.5" style={{ fontSize: 12, color: P.petrol }}>
        <ShieldCheck size={13} />
        Manager review required
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
        <Field label="Reviewed by (TL / direct manager)">
          <TSelect value={by} onChange={(ev) => setBy(ev.target.value)}>
            {tls.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </TSelect>
        </Field>
        <Field label="Assign to (investigating)">
          <TSelect
            value={assignee}
            onChange={(ev) => setAssignee(ev.target.value)}
            style={{ borderColor: assignee ? P.line : `${alpha(P.amber, 0.6)}` }}
          >
            <option value="">Unassigned</option>
            {tls.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </TSelect>
        </Field>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <Label>Review comment (required)</Label>
          <span className="ao-mono" style={{ fontSize: 11, color: short ? P.amber : P.green }}>
            {text.length}/{MIN_COMMENT}
          </span>
        </div>
        <div className="mt-1">
          <TArea
            placeholder="What actually happened, and why this is escalated or dismissed…"
            value={comment}
            onChange={(ev) => setComment(ev.target.value)}
            style={{ borderColor: short && text.length ? `${alpha(P.amber, 0.6)}` : P.line }}
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end mt-3 flex-wrap items-center">
        {why && (
          <span style={{ fontSize: 12, color: P.sub, marginRight: "auto" }}>
            {why}
          </span>
        )}
        <BtnGhost
          disabled={!canDismiss}
          color={P.sub}
          icon={Archive}
          onClick={() => canDismiss && onDecide("dismissed", by, assignee, text)}
        >
          Dismiss
        </BtnGhost>
        <BtnPrimary
          disabled={!canEscalate}
          icon={ArrowUpRight}
          onClick={() => canEscalate && onDecide("active", by, assignee, text)}
        >
          Escalate
        </BtnPrimary>
      </div>
    </div>
  );
}

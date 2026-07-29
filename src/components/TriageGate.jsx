/* Tab C — the manager triage gate, now with bulk actions.

   A PM clearing a morning's RTA import shouldn't write forty identical
   comments. Select rows, write the context once, escalate or dismiss the lot;
   the single-case ReviewBox stays for anything that needs individual judgment. */

import { useMemo, useState } from "react";
import { CircleCheck, ArrowUpRight, Archive, CheckSquare, Square } from "lucide-react";
import { SectionTitle, Muted, Field, TSelect, TArea, Label, BtnPrimary, BtnGhost } from "./ui/index.jsx";
import EntryCard from "./EntryCard.jsx";
import { MIN_COMMENT } from "./ReviewBox.jsx";
import { P, alpha } from "../lib/tokens.js";
import { plural } from "../lib/format.js";

export default function TriageGate({ rows, tls, me, canAct, onPatch, onDelete, onDecide, onBulk }) {
  const [selected, setSelected] = useState(() => new Set());
  const [assignee, setAssignee] = useState("");
  const [comment, setComment] = useState("");

  // Selection can go stale when cases leave the queue — intersect every render.
  const ids = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const active = useMemo(() => [...selected].filter((id) => ids.has(id)), [selected, ids]);

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(active.length === rows.length ? new Set() : new Set(rows.map((r) => r.id)));

  const text = comment.trim();
  const short = text.length < MIN_COMMENT;
  const canDismiss = canAct && active.length > 0 && !short;
  const canEscalate = canDismiss && !!assignee;

  const run = (stage) => {
    onBulk(active, stage, me.name, assignee, text);
    setSelected(new Set());
    setComment("");
  };

  return (
    <div>
      <SectionTitle count={rows.length}>Pending manager review</SectionTitle>
      <div className="mb-3">
        <Muted>
          Nothing here is punitive yet. Assign a manager, write at least {MIN_COMMENT} characters of context, then
          escalate into the OPS queue or dismiss and archive — one by one, or in bulk.
        </Muted>
      </div>

      {rows.length === 0 ? (
        <div className="p-6 text-center" style={{ background: P.card, border: `1px dashed ${P.line}`, borderRadius: 10 }}>
          <CircleCheck size={22} color={P.green} style={{ margin: "0 auto" }} />
          <div className="ao-disp font-bold uppercase tracking-wide mt-2" style={{ fontSize: 14, color: P.ink }}>
            Inbox clear
          </div>
          <Muted>Every logged case has been reviewed.</Muted>
        </div>
      ) : (
        <>
          {canAct && (
            <div className="p-3 mb-3" style={{ background: P.card, border: `1px solid ${active.length ? P.petrol : P.line}`, borderRadius: 10 }}>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={toggleAll}
                  className="ao-disp uppercase tracking-wide font-semibold inline-flex items-center gap-1.5"
                  style={{ fontSize: 12, color: P.petrol, border: "none", background: "none", cursor: "pointer" }}
                >
                  {active.length === rows.length ? <CheckSquare size={14} /> : <Square size={14} />}
                  {active.length === rows.length ? "Clear selection" : "Select all"}
                </button>
                <span className="ao-mono" style={{ fontSize: 12, color: active.length ? P.ink : P.sub }}>
                  {plural(active.length, "case")} selected
                </span>
              </div>

              {active.length > 0 && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <Field label="Assign all to (needed to escalate)">
                      <TSelect value={assignee} onChange={(e) => setAssignee(e.target.value)} style={{ borderColor: assignee ? P.line : `${alpha(P.amber, 0.6)}` }}>
                        <option value="">Unassigned</option>
                        {tls.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </TSelect>
                    </Field>
                    <div>
                      <div className="flex items-center justify-between">
                        <Label>Shared review comment</Label>
                        <span className="ao-mono" style={{ fontSize: 11, color: short ? P.amber : P.green }}>
                          {text.length}/{MIN_COMMENT}
                        </span>
                      </div>
                      <div className="mt-1">
                        <TArea
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder="Applies to every selected case…"
                          style={{ minHeight: 48 }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end mt-2 flex-wrap">
                    <BtnGhost disabled={!canDismiss} color={P.sub} icon={Archive} onClick={() => canDismiss && run("dismissed")}>
                      Bulk dismiss {active.length}
                    </BtnGhost>
                    <BtnPrimary disabled={!canEscalate} icon={ArrowUpRight} onClick={() => canEscalate && run("active")}>
                      Bulk escalate {active.length}
                    </BtnPrimary>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="grid gap-2">
            {rows.map((e) => (
              <EntryCard
                key={e.id}
                e={e}
                tls={tls}
                me={me}
                onPatch={onPatch}
                onDelete={onDelete}
                onDecide={onDecide}
                selectable={canAct}
                selected={selected.has(e.id)}
                onSelect={() => toggle(e.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

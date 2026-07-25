/* One case, everywhere it appears: the log, the triage inbox and both approval
   queues all render this. Which controls show depends on where the case has
   reached in the TL → OPS → HR pipeline. */

import { useState } from "react";
import { ChevronDown, ChevronUp, Trash2, Scale, MessageSquarePlus, CheckSquare, Square, Hourglass, Paperclip, RotateCcw, Timer, FileText, Gavel } from "lucide-react";
import { Pill, Toggle, TInput, BtnGhost, BtnPrimary, Label } from "./ui/index.jsx";
import ReviewBox from "./ReviewBox.jsx";
import { P, accColor, sevColor, STATUS_COLOR, alpha } from "../lib/tokens.js";
import { fmtMin, fmtDate, fmtStamp, days } from "../lib/format.js";
import { todayStr } from "../lib/dates.js";
import { statusOf, slaFor } from "../lib/engine.js";
import { PER_MONTH_CAP } from "../lib/constants.js";
import { can } from "../lib/auth.js";

const ACTION_LABEL = {
  escalated: "Escalated",
  dismissed: "Dismissed",
  comment: "Comment",
  notified: "Agent notified",
  ops: "Confirmed by OPS",
  hr: "Approved by HR",
  reopened: "Sent back to triage",
  voided: "Voided",
  restored: "Restored",
};

export default function EntryCard({ e, tls, me, onPatch, onDelete, onDecide, onRestore, onPurge, onResolveAppeal, selectable, selected, onSelect }) {
  const [showHistory, setShowHistory] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [hrRef, setHrRef] = useState(e.hrRef || "");
  const [appealNote, setAppealNote] = useState("");
  const canRuleAppeal = onResolveAppeal && (can(me, "hr") || can(me, "triage"));

  const st = statusOf(e);
  const sev = e.severity ? sevColor(e.severity) : P.green;
  const voided = !!e.voided;
  const dimmed = e.stage === "dismissed" || voided;
  const sla = slaFor(e);
  const capped = (e.deductionDays || 0) > (e.deductionApplied || 0);

  const log = (type, text, by = "") => ({ at: Date.now(), by, type, text });

  /* Pipeline steps auto-stamp their own activity and action date. */
  const advance = (key, type, text) => {
    const next = { ...e, [key]: !e[key] };
    const activity = [...(e.activity || [])];
    if (next[key]) activity.push(log(type, text));
    next.activity = activity;
    if (next.opsConfirmed && !next.actionDate) next.actionDate = todayStr();
    if (!next.opsConfirmed) next.actionDate = "";
    onPatch(next);
  };

  const confirmHr = () => {
    const ref = hrRef.trim();
    if (!ref) return;
    onPatch({
      ...e,
      hrConfirmed: true,
      hrRef: ref,
      actionDate: e.actionDate || todayStr(),
      activity: [...(e.activity || []), log("hr", `HR case reference ${ref} — executed.`)],
    });
  };

  // Escalation finalizes the verdict, which needs the whole ledger — the
  // recompute lives in App (engine.decideCases); this card just reports the call.
  const decide = (stage, by, assignee, text) => {
    if (onDecide) return onDecide(e.id, stage, by, assignee, text);
    onPatch({
      ...e,
      stage,
      assignee: stage === "active" ? assignee : e.assignee,
      activity: [...(e.activity || []), log(stage === "active" ? "escalated" : "dismissed", text, by)],
    });
  };

  const addComment = () => {
    const t = newComment.trim();
    if (!t) return;
    onPatch({ ...e, activity: [...(e.activity || []), log("comment", t)] });
    setNewComment("");
  };

  return (
    <article
      className="flex ao-glass"
      style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 8, overflow: "hidden", opacity: dimmed ? 0.7 : 1 }}
    >
      <div style={{ width: 5, background: dimmed ? "var(--dim)" : sev, flexShrink: 0 }} />
      <div className="p-3 flex-1 min-w-0">
        {/* Identity + status */}
        <div className="flex items-center gap-2 flex-wrap">
          {selectable && (
            <button
              onClick={onSelect}
              aria-label={selected ? "Deselect case" : "Select case"}
              style={{ border: "none", background: "none", cursor: "pointer", color: selected ? P.petrol : P.sub, display: "flex", padding: 0 }}
            >
              {selected ? <CheckSquare size={16} /> : <Square size={16} />}
            </button>
          )}
          <span className="ao-mono font-medium truncate" style={{ fontSize: 13, color: P.ink, maxWidth: "60%" }}>
            {e.email || e.agentName || e.empId}
          </span>
          {e.empId && (
            <span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>
              {e.empId}
            </span>
          )}
          {e.lob && (
            <span className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 10, color: P.sub, border: `1px solid ${P.line}`, borderRadius: 4, padding: "1px 5px" }}>
              {e.lob}
            </span>
          )}
          <span className="flex-1" />
          {sla && (
            <span
              className="ao-mono inline-flex items-center gap-1"
              title={`Waiting ${sla.ageDays} day${sla.ageDays === 1 ? "" : "s"} ${sla.label} · SLA target ${sla.limit}d`}
              style={{
                fontSize: 10.5,
                padding: "1px 6px",
                borderRadius: 999,
                color: sla.breached ? "#fff" : sla.warn ? P.amber : P.sub,
                background: sla.breached ? P.brick : "transparent",
                border: `1px solid ${sla.breached ? P.brick : sla.warn ? P.amber : P.line}`,
              }}
            >
              <Timer size={10} />
              {sla.ageDays}d {sla.label}
            </span>
          )}
          <Pill color={STATUS_COLOR[st]} filled={st !== "Closed" && st !== "Dismissed"}>
            {st}
          </Pill>
        </div>

        {/* Violation line */}
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <Pill color={dimmed ? "var(--dim)" : sev} filled>
            {e.violation}
            {e.occurrence ? ` · №${e.occurrence}` : ""}
          </Pill>
          {e.reclassifiedFrom && <Pill color={P.amber}>from {e.reclassifiedFrom}</Pill>}
          <span className="inline-flex items-center gap-1" style={{ fontSize: 12, color: P.sub }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: accColor(e.account), display: "inline-block" }} />
            {e.account}
          </span>
          <span style={{ fontSize: 12, color: P.sub }}>{fmtDate(e.date)}</span>
          <span className="ao-mono" style={{ fontSize: 12, color: P.sub }}>
            {e.shiftStart}–{e.shiftEnd}
          </span>
          {e.missingMin > 0 && (
            <span className="ao-mono" style={{ fontSize: 12, color: P.brick }}>
              −{fmtMin(e.missingMin)}
            </span>
          )}
        </div>

        {/* Prescribed action */}
        <div className="mt-2" style={{ fontSize: 13, color: P.inkSoft }}>
          <span className="font-semibold">{e.action}</span>
          <span style={{ color: P.sub }}>
            {" "}
            · {e.executor === "HR" ? "HR executes" : "TL executes"} · logged by {e.tl}
          </span>
          {e.sickNote && <span style={{ color: P.green }}> · certificate ✓</span>}
          {e.actionDate && <span style={{ color: P.sub }}> · actioned {fmtDate(e.actionDate)}</span>}
          {e.hrRef && (
            <span className="ao-mono" style={{ color: P.sub }}>
              {" "}
              · {e.hrRef}
            </span>
          )}
        </div>

        {e.notes && (
          <div className="mt-1 truncate" style={{ fontSize: 12, color: P.sub }}>
            “{e.notes}”
          </div>
        )}

        {e.evidenceUrl && (
          <div className="mt-1 flex items-center gap-1 min-w-0" style={{ fontSize: 12 }}>
            <Paperclip size={11} color={P.sub} style={{ flexShrink: 0 }} />
            {/^https?:\/\//i.test(e.evidenceUrl) ? (
              <a
                href={e.evidenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate"
                style={{ color: P.petrol, textDecoration: "underline" }}
                title={e.evidenceUrl}
              >
                {e.evidenceUrl}
              </a>
            ) : (
              <span className="truncate" style={{ color: P.sub }} title={e.evidenceUrl}>
                Evidence: {e.evidenceUrl}
              </span>
            )}
          </div>
        )}

        {/* Labour-law cap badge — only when the law actually bit */}
        {capped && !dimmed && (
          <div
            className="mt-2 flex items-start gap-2 p-2"
            style={{ background: P.amberWash, border: `1px solid ${alpha(P.amber, 0.33)}`, borderRadius: 6 }}
          >
            <Scale size={13} color={P.amber} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 12, color: P.inkSoft }}>
              <b>Labour law cap applied</b> — deductions limited to {PER_MONTH_CAP} days max per month. Prescribed{" "}
              {days(e.deductionDays)}, collectable {days(e.deductionApplied || 0)}.
            </span>
          </div>
        )}

        {voided && (
          <div className="mt-2 p-2" style={{ background: P.mist, borderRadius: 6, fontSize: 12.5, color: P.inkSoft }}>
            {(e.activity || [])
              .filter((a) => a.type === "voided")
              .slice(-1)
              .map((a, i) => (
                <span key={i}>
                  Voided{a.by ? ` by ${a.by}` : ""} · {fmtStamp(a.at)}
                </span>
              ))[0] || "Voided — excluded from all metrics and the engine."}
            <div className="ao-mono mt-1" style={{ fontSize: 11, color: P.sub }}>
              Restorable at any time · not counted while voided
            </div>
          </div>
        )}

        {e.appealState === "pending" && !voided && (
          <div className="mt-2 p-2.5" style={{ background: P.amberWash, border: `1px solid ${alpha(P.amber, 0.33)}`, borderRadius: 8 }}>
            <div className="flex items-center gap-2">
              <Gavel size={13} color={P.amber} style={{ flexShrink: 0 }} />
              <span className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 11.5, color: P.amber }}>
                Appeal pending
              </span>
            </div>
            <div className="mt-1" style={{ fontSize: 12.5, color: P.inkSoft }}>“{e.appealReason}”</div>
            {canRuleAppeal && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <TInput
                  placeholder="Decision note (optional)…"
                  value={appealNote}
                  onChange={(ev) => setAppealNote(ev.target.value)}
                  style={{ flex: 1, minWidth: 160, fontSize: 12.5, padding: "5px 8px" }}
                />
                <BtnGhost onClick={() => onResolveAppeal(e.id, "upheld", appealNote.trim())}>Uphold</BtnGhost>
                <BtnPrimary bg={P.green} onClick={() => onResolveAppeal(e.id, "overturned", appealNote.trim())}>
                  Overturn
                </BtnPrimary>
              </div>
            )}
          </div>
        )}

        {(e.appealState === "upheld" || e.appealState === "overturned") && (
          <div className="mt-2 inline-flex items-center gap-1.5" style={{ fontSize: 12, color: e.appealState === "overturned" ? P.green : P.sub }}>
            <Gavel size={12} />
            Appeal {e.appealState === "overturned" ? "granted — overturned" : "reviewed — upheld"}
            {e.appealNote ? ` · ${e.appealNote}` : ""}
          </div>
        )}

        {!voided &&
          e.stage === "review" &&
          (can(me, "triage") ? (
            <ReviewBox e={e} tls={tls} onDecide={decide} />
          ) : (
            <div className="mt-3 p-2 flex items-center gap-2" style={{ background: P.mist, borderRadius: 6, fontSize: 12.5, color: P.sub }}>
              <Hourglass size={13} />
              Awaiting Project Manager triage — your role can't rule on this case.
            </div>
          ))}

        {e.stage === "dismissed" &&
          (e.activity || [])
            .filter((a) => a.type === "dismissed")
            .slice(-1)
            .map((a, i) => (
              <div key={i} className="mt-2 p-2" style={{ background: P.mist, borderRadius: 6, fontSize: 12.5, color: P.inkSoft }}>
                Dismissed by <b>{a.by}</b>: {a.text}
                <div className="ao-mono mt-1" style={{ fontSize: 11, color: P.sub }}>
                  Archived {fmtStamp(a.at)} · excluded from metrics, hours lost and deductions
                </div>
              </div>
            ))}

        {/* Pipeline — each step belongs to a role; SuperAdmin can tap them all */}
        {!voided && e.stage === "active" && (
          <div className="flex items-center gap-2 flex-wrap mt-3">
            <Toggle
              on={e.notified}
              label="Agent notified"
              disabledLook={!can(me, "triage")}
              title={can(me, "triage") ? "" : "Project Manager step"}
              onClick={() => can(me, "triage") && advance("notified", "notified", "Agent notified of the case in writing.")}
            />
            <Toggle
              on={e.opsConfirmed}
              label="OPS confirm"
              disabledLook={!e.notified || !can(me, "ops")}
              title={!can(me, "ops") ? "Operations Lead step" : e.notified ? "" : "Notify the agent first"}
              onClick={() => e.notified && can(me, "ops") && advance("opsConfirmed", "ops", "Operations manager signed off.")}
            />
            {e.hrNeeded ? (
              e.hrConfirmed ? (
                <Toggle
                  on
                  label="HR confirm"
                  disabledLook={!can(me, "hr")}
                  title={can(me, "hr") ? "" : "HR Business Partner step"}
                  onClick={() =>
                    can(me, "hr") &&
                    onPatch({ ...e, hrConfirmed: false, activity: [...(e.activity || []), log("comment", "HR confirmation withdrawn.")] })
                  }
                />
              ) : (
                <Toggle on={false} label="HR confirm" disabledLook title="Enter an HR case reference below" onClick={() => {}} />
              )
            ) : (
              <Toggle
                on={false}
                label="HR n/a"
                disabledLook
                title={can(me, "triage") ? "Mark this case as requiring HR" : "Project Manager step"}
                onClick={() => can(me, "triage") && onPatch({ ...e, hrNeeded: true })}
              />
            )}
          </div>
        )}

        {/* HR execution gate */}
        {!voided && e.stage === "active" && e.hrNeeded && !e.hrConfirmed && e.opsConfirmed && can(me, "hr") && (
          <div className="mt-3 p-3" style={{ background: P.brickWash, border: `1px dashed ${alpha(P.brick, 0.4)}`, borderRadius: 8 }}>
            <Label>HR case reference (required to complete)</Label>
            <div className="flex gap-2 mt-1 flex-wrap">
              <TInput
                placeholder="HR-2026-0142"
                value={hrRef}
                onChange={(ev) => setHrRef(ev.target.value)}
                onKeyDown={(ev) => ev.key === "Enter" && confirmHr()}
                style={{ maxWidth: 220 }}
              />
              <BtnPrimary bg={P.brick} onClick={confirmHr} disabled={!hrRef.trim()}>
                Complete HR execution
              </BtnPrimary>
            </div>
            {(e.deductionApplied || 0) > 0 && (
              <div className="mt-2" style={{ fontSize: 12, color: P.sub }}>
                Executes a <b>{e.deductionApplied}-day</b> deduction and the formal warning letter.
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 flex-wrap mt-3" style={{ borderTop: `1px solid ${P.mist}`, paddingTop: 8 }}>
          {e.stage !== "review" &&
            (can(me, "triage") ? (
              <span className="inline-flex items-center gap-1" style={{ fontSize: 12, color: P.sub }}>
                Assignee
                <select
                  value={e.assignee || ""}
                  onChange={(ev) => onPatch({ ...e, assignee: ev.target.value })}
                  style={{ fontSize: 12, color: P.ink, border: `1px solid ${P.line}`, borderRadius: 6, padding: "2px 6px", background: "var(--well)" }}
                >
                  <option value="">Unassigned</option>
                  {tls.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </span>
            ) : (
              e.assignee && (
                <span style={{ fontSize: 12, color: P.sub }}>
                  Assignee <b style={{ color: P.inkSoft }}>{e.assignee}</b>
                </span>
              )
            ))}
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="inline-flex items-center gap-1"
            style={{ fontSize: 12, color: P.petrol, background: "none", border: "none", cursor: "pointer" }}
          >
            History ({(e.activity || []).length})
            {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {e.disciplinary && !voided && (
            <a
              href={`/api/cases/${e.id}/letter`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1"
              style={{ fontSize: 12, color: P.petrol, textDecoration: "none" }}
              title="Download the formal warning letter (PDF)"
            >
              <FileText size={12} />
              Letter
            </a>
          )}
          <span className="flex-1" />
          {can(me, "delete") &&
            (voided ? (
              <>
                <button
                  onClick={() => onRestore && onRestore(e)}
                  className="inline-flex items-center gap-1"
                  style={{ fontSize: 12, color: P.green, background: "none", border: "none", cursor: "pointer" }}
                >
                  <RotateCcw size={12} />
                  Restore
                </button>
                <button
                  onClick={() => {
                    if (window.confirm("Permanently delete this case? This erases the record and cannot be undone."))
                      onPurge && onPurge(e.id);
                  }}
                  className="inline-flex items-center gap-1"
                  style={{ fontSize: 12, color: P.brick, background: "none", border: "none", cursor: "pointer" }}
                >
                  <Trash2 size={12} />
                  Delete permanently
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  if (window.confirm("Void this case? It's kept and restorable, but excluded from all metrics.")) onDelete(e.id);
                }}
                className="inline-flex items-center gap-1"
                style={{ fontSize: 12, color: P.sub, background: "none", border: "none", cursor: "pointer" }}
              >
                <Trash2 size={12} />
                Void
              </button>
            ))}
        </div>

        {showHistory && (
          <div className="mt-2 grid gap-1">
            {(e.activity || []).length === 0 && <div style={{ fontSize: 12, color: P.sub }}>No activity yet.</div>}
            {(e.activity || []).map((a, i) => (
              <div key={i} style={{ fontSize: 12.5, color: P.inkSoft }}>
                <span className="ao-mono" style={{ color: P.sub, fontSize: 11 }}>
                  {fmtStamp(a.at)}
                </span>
                {" · "}
                <b style={{ color: a.type === "dismissed" ? P.sub : a.type === "escalated" ? P.petrol : P.ink }}>
                  {ACTION_LABEL[a.type] || a.type}
                </b>
                {a.by ? ` by ${a.by}` : ""} — {a.text}
              </div>
            ))}
            <div className="flex gap-2 mt-1">
              <TInput
                placeholder="Add a comment…"
                value={newComment}
                onChange={(ev) => setNewComment(ev.target.value)}
                onKeyDown={(ev) => ev.key === "Enter" && addComment()}
                style={{ fontSize: 13, padding: "6px 8px" }}
              />
              <BtnGhost onClick={addComment} icon={MessageSquarePlus}>
                Add
              </BtnGhost>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

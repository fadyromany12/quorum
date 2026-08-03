"use client";

/* Approvals — what is waiting on me, and who is covering for me.

   An approval inbox is judged on one thing: whether the person can decide
   without leaving it. So each item carries everything the decision needs — who,
   what, how long it has waited, and the controls inline. Nothing opens a
   sub-page, because a queue that costs a navigation per item is a queue that
   grows.

   Partial approval is a first-class control rather than a hidden option. An
   approver who can only say yes or no to five days will say no to five days,
   when three were available. */

import { useCallback, useEffect, useState } from "react";
import {
  CheckCheck, RefreshCw, Clock, TriangleAlert, UserCheck, X, Check,
  CalendarDays, Users2, Scale, Gavel, FileText, ArrowRightLeft, UserMinus, Landmark, Gauge,
} from "lucide-react";
import { Card, Pill, Muted, BtnGhost, BtnPrimary, TInput } from "./ui/index.jsx";
import Tip from "./ui/Tip.jsx";
import { P } from "../lib/tokens.js";
import { plural } from "../lib/format.js";
import { displayName } from "../lib/employee.js";

const TYPE_META = {
  leave: { icon: CalendarDays, color: P.petrol },
  overtime: { icon: Clock, color: P.petrol },
  resignation: { icon: UserMinus, color: P.brick },
  transfer: { icon: ArrowRightLeft, color: P.amber },
  termination: { icon: Gavel, color: P.brick },
  noShow: { icon: TriangleAlert, color: P.brick },
  payChange: { icon: Landmark, color: P.green },
  letterRequest: { icon: FileText, color: P.sub },
};

/* One item. Local state on purpose: a partial grant and a rejection note are
   per-item drafts, and hoisting them would make every keystroke re-render the
   whole queue. */
function InboxItem({ item, onDecided, onError }) {
  const r = item.request;
  const cfg = r.config || {};
  const meta = TYPE_META[r.type] || { icon: Scale, color: P.sub };
  const Icon = meta.icon;

  const [grant, setGrant] = useState(r.requestedUnits ?? "");
  const [note, setNote] = useState("");
  const [proposal, setProposal] = useState(r.proposedValue ?? "");
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  /* What approving this would do to cover. Advisory: the request is for dated
     absence, so the only thing worth asking is whether the floor holds without
     them — and the answer is only fetched for requests that actually have
     dates, because there is nothing to ask about a salary letter. */
  const [impact, setImpact] = useState(null);
  useEffect(() => {
    if (!r.payload?.from || !r.subject?.id) return;
    let live = true;
    const q = new URLSearchParams({ employeeId: r.subject.id, from: r.payload.from, to: r.payload.to || r.payload.from });
    fetch(`/api/wfm/impact?${q}`)
      .then((res) => (res.ok ? res.json() : null))
      /* A 403 here is normal — an approver without wfmRead simply does not see
         the line. Failing quiet is right: cover advice is a bonus on a screen
         whose actual job is the decision. */
      .then((j) => live && j && setImpact(j))
      .catch(() => {});
    return () => { live = false; };
  }, [r.payload?.from, r.payload?.to, r.subject?.id]);

  const send = async (decision) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/requests/${r.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          ...(cfg.partial && decision === "approve" ? { grantedUnits: Number(grant) } : {}),
          ...(cfg.chain === "coApproval" && decision === "approve" ? { proposedValue: proposal } : {}),
          note,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "That did not go through.");
      onDecided();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const overdue = item.sla?.breached;
  const reduced = cfg.partial && Number(grant) > 0 && Number(grant) < Number(r.requestedUnits);

  return (
    <div
      style={{
        background: overdue ? P.brickWash : P.card,
        border: `1px solid ${overdue ? P.brick : P.line}`,
        borderLeft: `3px solid ${meta.color}`,
        borderRadius: 12,
        padding: 14,
        display: "grid",
        gap: 10,
      }}
    >
      <div className="flex items-start gap-2.5 flex-wrap">
        <Icon size={15} color={meta.color} style={{ flexShrink: 0, marginTop: 2 }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill color={meta.color}>{cfg.label || r.type}</Pill>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: P.ink }}>
              {displayName(r.subject || {})}
            </span>
            <span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>{r.subject?.empId}</span>
            {item.viaDelegation && (
              <Pill color={P.amber}>
                <span className="inline-flex items-center gap-1"><UserCheck size={10} />as delegate</span>
              </Pill>
            )}
          </div>

          <div className="mt-1" style={{ fontSize: 12.5, color: P.inkSoft }}>
            {cfg.partial && r.requestedUnits != null && (
              <span>{plural(Number(r.requestedUnits), cfg.unit?.replace(/s$/, "") || "unit")} requested</span>
            )}
            {cfg.chain === "coApproval" && r.proposedValue && (
              <span>Proposed {cfg.agreeOn}: <strong>{r.proposedValue}</strong></span>
            )}
            {r.payload?.from && (
              <span>{cfg.partial ? " · " : ""}{r.payload.from}{r.payload.to && r.payload.to !== r.payload.from ? ` → ${r.payload.to}` : ""}</span>
            )}
          </div>
          {r.payload?.reason && (
            <div className="mt-0.5" style={{ fontSize: 12.5, color: P.sub, overflowWrap: "anywhere" }}>
              “{r.payload.reason}”
            </div>
          )}

          {/* Cover advice. Never a veto — the button stays enabled either way,
              and an approver who knows something the roster does not is right
              more often than the roster is. */}
          {impact && (
            <Tip
              label={
                impact.unplannedDays
                  ? `${impact.plannedDays} day(s) planned, ${impact.unplannedDays} with no forecast to judge against`
                  : impact.days.find((d) => d.coverable === false)?.verdict || impact.days[0]?.verdict || ""
              }
            >
              <div
                className="mt-1.5 inline-flex items-start gap-1.5"
                style={{
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  color: impact.plannedDays === 0 ? P.sub : impact.coverable ? P.green : P.amber,
                }}
              >
                <Gauge size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{impact.headline}</span>
              </div>
            </Tip>
          )}
        </div>

        <div className="text-right" style={{ flexShrink: 0 }}>
          <div className="ao-mono" style={{ fontSize: 11, color: overdue ? P.brick : P.sub, whiteSpace: "nowrap" }}>
            {item.sla ? `waited ${plural(item.sla.waitedDays, "day")}` : r.raisedOn}
          </div>
          {overdue && (
            <div className="ao-mono" style={{ fontSize: 10.5, color: P.brick }}>
              {plural(item.sla.overdueBy, "day")} over
            </div>
          )}
        </div>
      </div>

      {/* ── Controls ── */}
      {!rejecting ? (
        <div className="flex items-center gap-2 flex-wrap pt-2" style={{ borderTop: `1px solid ${P.line}` }}>
          {cfg.partial && (
            <label className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: P.sub }}>
              Approve
              <input
                type="number"
                min="0"
                max={r.requestedUnits ?? undefined}
                step="0.5"
                value={grant}
                onChange={(e) => setGrant(e.target.value)}
                aria-label={`How many ${cfg.unit} to approve`}
                style={{
                  width: 62, fontSize: 12.5, padding: "5px 8px", borderRadius: 8,
                  border: `1px solid ${reduced ? P.amber : P.line}`, background: "var(--well)", color: P.ink,
                }}
              />
              of {r.requestedUnits} {cfg.unit}
            </label>
          )}

          {cfg.chain === "coApproval" && (
            <label className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: P.sub }}>
              {cfg.agreeOn}
              <input
                type="date"
                value={proposal}
                onChange={(e) => setProposal(e.target.value)}
                aria-label={`Your proposed ${cfg.agreeOn}`}
                style={{
                  fontSize: 12.5, padding: "5px 8px", borderRadius: 8,
                  border: `1px solid ${P.line}`, background: "var(--well)", color: P.ink,
                }}
              />
            </label>
          )}

          <span className="flex-1" />
          <BtnGhost onClick={() => setRejecting(true)} icon={X} disabled={busy}>Reject</BtnGhost>
          <BtnPrimary onClick={() => send("approve")} disabled={busy}>
            <span className="inline-flex items-center gap-1.5">
              <Check size={13} />
              {reduced ? `Approve ${grant}` : "Approve"}
            </span>
          </BtnPrimary>
        </div>
      ) : (
        <div className="grid gap-2 pt-2" style={{ borderTop: `1px solid ${P.line}` }}>
          {/* A reason is required by the API; asking for it here rather than
              bouncing the request back is the difference between a form and a
              fight. */}
          <TInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why are you rejecting it? The requester will see this."
            autoFocus
          />
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 11.5, color: P.sub }}>Required — they cannot act on “no” alone.</span>
            <span className="flex-1" />
            <BtnGhost onClick={() => { setRejecting(false); setNote(""); }} disabled={busy}>Cancel</BtnGhost>
            <button
              type="button"
              onClick={() => send("reject")}
              disabled={busy || !note.trim()}
              className="ao-disp uppercase tracking-wide font-semibold"
              style={{
                fontSize: 11.5, padding: "7px 14px", borderRadius: 9,
                border: `1px solid ${P.brick}`, background: P.brickWash, color: P.brick,
                cursor: busy || !note.trim() ? "not-allowed" : "pointer",
                opacity: busy || !note.trim() ? 0.5 : 1,
              }}
            >
              Confirm rejection
            </button>
          </div>
        </div>
      )}

      {cfg.consequence && (
        <div style={{ fontSize: 11, color: P.amber }}>{cfg.consequence}</div>
      )}
    </div>
  );
}

/* Delegation. Deliberately on this screen rather than buried in settings: the
   moment an approver realises they need cover is the moment they are looking at
   a queue they cannot clear. */
function DelegationPanel({ people, onError }) {
  const [current, setCurrent] = useState(undefined); // undefined = loading
  const [delegateId, setDelegateId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/delegations");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load your delegation.");
      setCurrent(json.delegation);
    } catch (err) {
      onError(err.message);
      setCurrent(null);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!delegateId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/delegations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delegateId, from, to }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not set the delegation.");
      setDelegateId(""); setFrom(""); setTo("");
      await load();
    } catch (err) { onError(err.message); } finally { setBusy(false); }
  };

  const end = async () => {
    setBusy(true);
    try {
      await fetch("/api/delegations", { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  };

  const nameOf = (id) => displayName(people.find((p) => p.id === id) || {}) || id;

  return (
    <Card title={<span className="inline-flex items-center gap-2"><UserCheck size={14} />Delegate approvals</span>}>
      <div style={{ fontSize: 12.5, color: P.sub, marginBottom: 10 }}>
        Let someone approve on your behalf — while you are away, or as a standing
        arrangement. Leave the dates blank and it runs until you end it.
      </div>

      {current === undefined && <div className="ao-skeleton" style={{ height: 38, borderRadius: 10 }} />}

      {current && (
        <div
          className="flex items-center gap-3 flex-wrap mb-3"
          style={{ background: P.amberWash, border: `1px solid ${P.amber}`, borderRadius: 10, padding: "10px 13px" }}
        >
          <UserCheck size={14} color={P.amber} />
          <div className="flex-1 min-w-0" style={{ fontSize: 12.5, color: P.amber }}>
            <strong>{nameOf(current.delegateId)}</strong> is approving for you
            {current.from || current.to
              ? ` (${current.from || "now"} → ${current.to || "until you end it"})`
              : " until you end it"}.
          </div>
          <BtnGhost onClick={end} disabled={busy}>End it</BtnGhost>
        </div>
      )}

      {current === null && <Muted>No one is currently approving on your behalf.</Muted>}

      <div className="flex items-end gap-2 flex-wrap mt-2">
        <label className="grid gap-1">
          <span className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>
            Who approves for you
          </span>
          <select
            value={delegateId}
            onChange={(e) => setDelegateId(e.target.value)}
            style={{ fontSize: 12.5, padding: "7px 10px", borderRadius: 9, border: `1px solid ${P.line}`, background: P.card, color: P.ink, minWidth: 190 }}
          >
            <option value="">Choose someone…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{displayName(p)} · {p.empId}</option>
            ))}
          </select>
        </label>
        {[["From (optional)", from, setFrom], ["Until (optional)", to, setTo]].map(([label, val, set]) => (
          <label key={label} className="grid gap-1">
            <span className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>{label}</span>
            <input
              type="date"
              value={val}
              onChange={(e) => set(e.target.value)}
              style={{ fontSize: 12.5, padding: "6px 9px", borderRadius: 9, border: `1px solid ${P.line}`, background: "var(--well)", color: P.ink }}
            />
          </label>
        ))}
        <BtnPrimary onClick={save} disabled={busy || !delegateId}>Set delegation</BtnPrimary>
      </div>
    </Card>
  );
}

export default function RequestInbox({ people = [] }) {
  const [items, setItems] = useState(null); // null = loading
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/requests?view=inbox");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load your approvals.");
      setItems(json.items);
    } catch (err) {
      setError(err.message);
      setItems([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const overdueCount = (items || []).filter((i) => i.sla?.breached).length;

  return (
    <div className="grid gap-3">
      <Card
        title={<span className="inline-flex items-center gap-2"><CheckCheck size={14} />Waiting on you</span>}
        right={
          <div className="flex items-center gap-2">
            {items && (
              <span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>
                {plural(items.length, "request")}
              </span>
            )}
            <BtnGhost onClick={load} icon={RefreshCw}>Refresh</BtnGhost>
          </div>
        }
      >
        {error && (
          <div className="mb-3" role="alert" style={{ fontSize: 13, color: P.brick }}>{error}</div>
        )}

        {overdueCount > 0 && (
          <div
            className="flex items-center gap-2 mb-3"
            style={{ background: P.brickWash, border: `1px solid ${P.brick}`, borderRadius: 10, padding: "9px 12px", fontSize: 12.5, color: P.brick }}
          >
            <TriangleAlert size={13} />
            {plural(overdueCount, "request")} past its target — these escalate if left.
          </div>
        )}

        {items === null && (
          <div className="grid gap-2" aria-busy="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="ao-skeleton" style={{ height: 108, borderRadius: 12 }} />
            ))}
          </div>
        )}

        {items !== null && items.length === 0 && !error && (
          <Muted>Nothing is waiting on you.</Muted>
        )}

        <div className="grid gap-2.5">
          {(items || []).map((i) => (
            <InboxItem key={i.request.id} item={i} onDecided={load} onError={setError} />
          ))}
        </div>
      </Card>

      <DelegationPanel people={people} onError={setError} />
    </div>
  );
}

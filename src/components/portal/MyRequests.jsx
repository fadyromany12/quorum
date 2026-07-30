"use client";

/* My requests — ask for leave, and see what happened to everything I've asked
   for.

   The balance is the leave ledger's sum: monthly accruals credited since hire,
   minus days granted, plus any HR adjustments. The derivation rides along with
   the number, because a balance that cannot show its work is just an assertion
   — and the ledger is brought up to date on read, so it never depends on
   whether a cron has run.

   Partial outcomes are surfaced prominently. "You asked for five and got three"
   is the single most confusing thing an approval system can leave implicit, and
   the two days that came back are the whole reason the distinction matters. */

import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays, Send, RefreshCw, Check, X, Clock, Undo2, TriangleAlert, Scale,
} from "lucide-react";
import { Card, Pill, Muted, BtnGhost, BtnPrimary, TInput, TSelect, Label } from "../ui/index.jsx";
import { P } from "../../lib/tokens.js";
import { plural } from "../../lib/format.js";
import { daysBetween, todayStr } from "../../lib/dates.js";

const LEAVE_TYPES = ["Annual", "Sick", "Casual", "Unpaid"];

const STATUS_META = {
  pending: { color: P.amber, label: "Awaiting approval", icon: Clock },
  approved: { color: P.green, label: "Approved", icon: Check },
  partial: { color: P.amber, label: "Partly approved", icon: Scale },
  rejected: { color: P.brick, label: "Rejected", icon: X },
  withdrawn: { color: "var(--dim)", label: "Withdrawn", icon: Undo2 },
  autoResolved: { color: P.petrol, label: "Settled automatically", icon: Clock },
};

export default function MyRequests({ entitlementDays = 0 }) {
  const [rows, setRows] = useState(null);
  const [led, setLed] = useState(null); // the ledger: balance + derivation
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [leaveType, setLeaveType] = useState("Annual");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [reqRes, ledRes] = await Promise.all([
        fetch("/api/requests?view=mine"),
        fetch("/api/leave/balance"),
      ]);
      const reqJson = await reqRes.json().catch(() => ({}));
      const ledJson = await ledRes.json().catch(() => ({}));
      if (!reqRes.ok) throw new Error(reqJson.error || "Could not load your requests.");
      setRows(reqJson.requests);
      setLed(ledRes.ok ? ledJson : null);
    } catch (err) {
      setError(err.message);
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Whole days, both ends inclusive — the way anyone booking time off counts it.
     A one-day request is one day, not zero. */
  const span = from ? (daysBetween(from, to || from) + 1) : 0;
  const validSpan = Number.isFinite(span) && span > 0;

  const leave = (rows || []).filter((r) => r.type === "leave");
  const awaiting = leave
    .filter((r) => r.status === "pending")
    .reduce((s, r) => s + Number(r.requestedUnits ?? 0), 0);
  // The ledger is the truth; the request list is only used for what is still
  // pending, which by definition has not touched the ledger yet.
  const accrued = led?.byType?.accrual ?? 0;
  const taken = -(led?.byType?.grant ?? 0);
  const remaining = led ? led.balance : 0;

  const submit = async () => {
    if (!validSpan) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "leave",
          requestedUnits: span,
          payload: { leaveType, from, to: to || from, reason },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not submit your request.");
      setFrom(""); setTo(""); setReason("");
      setNotice(`Submitted — ${plural(span, "day")} awaiting approval.`);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const withdraw = async (id) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/requests/${id}/withdraw`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not withdraw it.");
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-3">
      {/* ── Balance ── */}
      <Card title={<span className="inline-flex items-center gap-2"><CalendarDays size={14} />Leave</span>}>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))" }}>
          {[
            ["Remaining", remaining, P.green],
            ["Accrued", accrued, P.ink],
            ["Taken", taken, P.inkSoft],
            ["Awaiting", awaiting, P.amber],
            ["Per year", entitlementDays, P.petrol],
          ].map(([label, value, color]) => (
            <div key={label}>
              <div className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, letterSpacing: 0.6 }}>
                {label}
              </div>
              <div className="ao-disp" style={{ fontSize: 24, fontWeight: 650, color, lineHeight: 1.1 }}>
                {value}
              </div>
              <div style={{ fontSize: 10.5, color: P.sub }}>days</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: P.sub, marginTop: 10, borderTop: `1px solid ${P.line}`, paddingTop: 9 }}>
          Your balance is a ledger: one twelfth of your yearly entitlement is credited at
          the end of each month, and approved days are deducted when they are granted.
          The yearly rate follows Labour Law No. 12/2003 Art. 47 — 15 days once you pass
          six months, 21 after a full year, 30 after ten years or at age 50.
          {led?.entries?.length > 0 && ` ${led.entries.length} entries stand behind this number.`}
        </div>
      </Card>

      {/* ── Request ── */}
      <Card title="Request leave">
        {error && <div className="mb-3" role="alert" style={{ fontSize: 13, color: P.brick }}>{error}</div>}
        {notice && (
          <div className="mb-3" style={{ background: P.greenWash, border: `1px solid ${P.green}`, borderRadius: 10, padding: "9px 12px", fontSize: 12.5, color: P.green }}>
            {notice}
          </div>
        )}

        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <div className="grid gap-1">
            <Label>Leave type</Label>
            <TSelect value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
              {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </TSelect>
          </div>
          <div className="grid gap-1">
            <Label>First day</Label>
            <TInput type="date" value={from} min={todayStr()} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>Last day</Label>
            <TInput type="date" value={to} min={from || todayStr()} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="grid gap-1 mt-3">
          <Label>Reason (optional)</Label>
          <TInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
        </div>

        <div className="flex items-center gap-3 flex-wrap mt-3">
          {validSpan && (
            <span style={{ fontSize: 12.5, color: span > remaining ? P.amber : P.inkSoft }}>
              {plural(span, "day")}
              {span > remaining && ` — more than the ${remaining} you have left`}
            </span>
          )}
          {from && to && !validSpan && (
            <span style={{ fontSize: 12.5, color: P.brick }}>The last day is before the first.</span>
          )}
          <span className="flex-1" />
          <BtnPrimary onClick={submit} disabled={busy || !validSpan}>
            <span className="inline-flex items-center gap-1.5"><Send size={13} />Submit request</span>
          </BtnPrimary>
        </div>

        <div style={{ fontSize: 11, color: P.sub, marginTop: 8 }}>
          Goes to your functional manager first, then your direct manager. Either
          may approve fewer days than you ask for — any they do not approve stay
          available to you.
        </div>
      </Card>

      {/* ── History ── */}
      <Card
        title="My requests"
        right={<BtnGhost onClick={load} icon={RefreshCw}>Refresh</BtnGhost>}
      >
        {rows === null && (
          <div className="grid gap-2" aria-busy="true">
            {Array.from({ length: 2 }, (_, i) => <div key={i} className="ao-skeleton" style={{ height: 62, borderRadius: 11 }} />)}
          </div>
        )}
        {rows !== null && rows.length === 0 && <Muted>You have not raised anything yet.</Muted>}

        <div className="grid gap-2">
          {(rows || []).map((r) => {
            const meta = STATUS_META[r.status] || { color: P.sub, label: r.status, icon: Clock };
            const Icon = meta.icon;
            const reduced = r.status === "partial";
            const rejection = r.steps?.find((s) => s.state === "rejected");
            return (
              <div
                key={r.id}
                className="flex items-start gap-3 p-3"
                style={{ background: P.mist, borderRadius: 11, borderLeft: `3px solid ${meta.color}` }}
              >
                <Icon size={14} color={meta.color} style={{ flexShrink: 0, marginTop: 2 }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Pill color={meta.color}>{meta.label}</Pill>
                    <span style={{ fontSize: 12.5, color: P.ink, fontWeight: 500 }}>
                      {r.config?.label || r.type}
                    </span>
                    {r.payload?.leaveType && (
                      <span style={{ fontSize: 11.5, color: P.sub }}>{r.payload.leaveType}</span>
                    )}
                    <span className="flex-1" />
                    <span className="ao-mono" style={{ fontSize: 11, color: P.sub, whiteSpace: "nowrap" }}>
                      {r.raisedOn}
                    </span>
                  </div>

                  <div className="mt-0.5" style={{ fontSize: 12.5, color: P.inkSoft }}>
                    {r.payload?.from && (
                      <span>
                        {r.payload.from}
                        {r.payload.to && r.payload.to !== r.payload.from ? ` → ${r.payload.to}` : ""}
                        {" · "}
                      </span>
                    )}
                    {r.requestedUnits != null && <span>{plural(Number(r.requestedUnits), "day")} requested</span>}
                    {r.grantedUnits != null && r.grantedUnits !== Number(r.requestedUnits) && (
                      <span style={{ color: P.amber }}>, {r.grantedUnits} granted</span>
                    )}
                  </div>

                  {/* The two days that came back are the whole point of partial. */}
                  {reduced && (
                    <div className="mt-1" style={{ fontSize: 12, color: P.amber }}>
                      <TriangleAlert size={11} style={{ display: "inline", verticalAlign: -1 }} />{" "}
                      {plural(Number(r.requestedUnits) - Number(r.grantedUnits), "day")} were not approved and
                      remain available to you.
                    </div>
                  )}

                  {rejection?.note && (
                    <div className="mt-1" style={{ fontSize: 12, color: P.brick, overflowWrap: "anywhere" }}>
                      “{rejection.note}”
                    </div>
                  )}

                  {r.status === "pending" && r.sla && (
                    <div className="mt-1" style={{ fontSize: 11, color: r.sla.breached ? P.brick : P.sub }}>
                      Waiting {plural(r.sla.waitedDays, "day")}
                      {r.sla.breached ? ` — ${plural(r.sla.overdueBy, "day")} past target` : `, target ${r.sla.dueOn}`}
                    </div>
                  )}
                </div>

                {r.status === "pending" && (
                  <BtnGhost onClick={() => withdraw(r.id)} icon={Undo2} disabled={busy}>Withdraw</BtnGhost>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

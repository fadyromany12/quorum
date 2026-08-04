"use client";

/* The file, and what is wrong with it.

   Ordered by what somebody has to do rather than by what is there. Missing
   first, then lapsed, then about to lapse, then everything held and current
   collapsed underneath — because a list sorted by document type puts a valid
   contract above an expired work permit, and the expired work permit is the
   only row anybody needs to see today.

   The distinction the panel exists to keep visible: a document nobody ever
   provided and one that lapsed are different problems. Chasing the employee and
   chasing a renewal are different jobs, and a single "78% complete" hides
   which one you have. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Plus, ShieldCheck, TriangleAlert, Clock, X, ExternalLink, Lock } from "lucide-react";
import { Card, Muted, Pill, BtnGhost, BtnPrimary, TInput, TSelect, TArea, Field } from "./ui/index.jsx";
import { P, alpha } from "../lib/tokens.js";
import { docStatus, daysLeft, checkDocument, summarise } from "../lib/documents.js";
import { todayStr } from "../lib/dates.js";

const TONE = { expired: P.brick, expiringSoon: P.amber, valid: P.green, noExpiry: P.sub };

export default function Documents({ employeeId, employeeName = "" }) {
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ kind: "", location: "", title: "", issuedOn: "", expiresOn: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/employees/${employeeId}/documents`);
    const j = await res.json().catch(() => ({}));
    if (res.ok) setData(j);
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  const check = useMemo(() => checkDocument(form, { today: todayStr() }), [form]);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/employees/${employeeId}/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "That did not work.");
      setForm({ kind: "", location: "", title: "", issuedOn: "", expiresOn: "", note: "" });
      setAdding(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (docId) => {
    await fetch(`/api/employees/${employeeId}/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "verify", docId }),
    });
    await load();
  };

  const voidDoc = async (docId) => {
    const reason = window.prompt("Why is this being removed? The row is kept either way.");
    if (!reason?.trim()) return;
    await fetch(`/api/employees/${employeeId}/documents?docId=${docId}&reason=${encodeURIComponent(reason)}`, { method: "DELETE" });
    await load();
  };

  if (!data) {
    return (
      <Card title={<span className="inline-flex items-center gap-2"><FolderOpen size={14} />Documents</span>}>
        <Muted>Loading the file…</Muted>
      </Card>
    );
  }

  const { state, documents, kinds, canWrite } = data;
  const live = documents.filter((d) => !d.voided);
  const settled = live.filter((d) => ["valid", "noExpiry"].includes(docStatus(d, todayStr())));

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><FolderOpen size={14} />Documents</span>}
      right={
        <div className="flex flex-wrap items-center gap-2">
          <Pill color={state.complete ? P.green : state.expired.length || state.missing.length ? P.brick : P.amber} filled={!state.complete}>
            {summarise(state)}
          </Pill>
          {canWrite && !adding && <BtnGhost icon={Plus} onClick={() => setAdding(true)}>Record one</BtnGhost>}
        </div>
      }
    >
      <Muted>
        The app holds where each document is, not the document — the same way case evidence works. What it owns is
        the part a folder cannot tell you: what is missing, what has lapsed, and what is about to.
      </Muted>

      {/* Missing and expired first, because they are the work. */}
      {state.missing.length > 0 && (
        <div className="mt-3 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 12.5 }}>
          <strong style={{ color: P.brick }}>Never provided</strong>
          <div style={{ color: P.inkSoft }}>
            {state.missing.map((m) => m.label).join(", ")} — {employeeName ? `ask ${employeeName.split(" ")[0]}` : "chase the employee"}.
          </div>
        </div>
      )}
      {state.expired.length > 0 && (
        <div className="mt-2 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 12.5 }}>
          <strong style={{ color: P.brick }}>Lapsed</strong>
          <div style={{ color: P.inkSoft }}>
            {/* Not the same problem as missing: this one is a renewal, not a chase. */}
            {state.expired.map((d) => `${d.label} (${Math.abs(d.days)} days ago)`).join(", ")} — chase the renewal.
          </div>
        </div>
      )}
      {state.expiring.length > 0 && (
        <div className="mt-2 p-3" style={{ background: P.amberWash, border: `1px solid ${alpha(P.amber, 0.4)}`, borderRadius: 8, fontSize: 12.5 }}>
          <strong style={{ color: P.amber }}>Expiring</strong>
          <div style={{ color: P.inkSoft }}>
            {state.expiring.map((d) => `${d.label} in ${d.days} days`).join(", ")}.
          </div>
        </div>
      )}

      {adding && (
        <div className="mt-3 p-3" style={{ border: `1px solid ${alpha(P.ink, 0.14)}`, borderRadius: 9 }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind">
              <TSelect value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
                <option value="">Choose…</option>
                {Object.entries(kinds).map(([k, meta]) => (
                  <option key={k} value={k}>{meta.label}{meta.statutory ? " — required" : ""}</option>
                ))}
              </TSelect>
            </Field>
            <Field label="Where it is">
              <TInput
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder="A link, or 'Cabinet 3, folder B'"
              />
            </Field>
            <Field label="Issued">
              <TInput type="date" value={form.issuedOn} onChange={(e) => setForm((f) => ({ ...f, issuedOn: e.target.value }))} />
            </Field>
            <Field label="Expires">
              <TInput type="date" value={form.expiresOn} onChange={(e) => setForm((f) => ({ ...f, expiresOn: e.target.value }))} />
            </Field>
          </div>
          <div className="mt-2">
            <Field label="Note (optional)">
              <TArea rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </Field>
          </div>

          {check.problems.length > 0 && <div className="mt-2" style={{ fontSize: 12.5, color: P.amber }}>{check.problems[0]}</div>}
          {check.problems.length === 0 && check.warnings.length > 0 && (
            <div className="mt-2" style={{ fontSize: 12.5, color: P.sub }}>{check.warnings[0]}</div>
          )}
          {error && <div className="mt-2" role="alert" style={{ fontSize: 12.5, color: P.brick }}>{error}</div>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <BtnPrimary onClick={save} disabled={check.problems.length > 0 || busy}>{busy ? "Saving…" : "Record it"}</BtnPrimary>
            <BtnGhost onClick={() => { setAdding(false); setError(""); }}>Cancel</BtnGhost>
          </div>
        </div>
      )}

      {/* The rows themselves. */}
      <div className="mt-3 grid gap-1.5">
        {live.length === 0 && !adding && <Muted>Nothing on file yet.</Muted>}
        {live.map((d) => {
          const status = docStatus(d, todayStr());
          const days = daysLeft(d, todayStr());
          const meta = kinds[d.kind] ?? {};
          const settledRow = settled.includes(d);
          return (
            <div
              key={d.id}
              className="flex flex-wrap items-center gap-2 p-2"
              style={{ border: `1px solid ${alpha(P.ink, 0.1)}`, borderRadius: 8, opacity: settledRow ? 0.75 : 1, fontSize: 12.5 }}
            >
              <span style={{ fontWeight: 600 }}>{meta.label ?? d.kind}</span>
              {d.title && <span style={{ color: P.sub }}>{d.title}</span>}

              {status !== "noExpiry" && (
                <Pill color={TONE[status]} filled={status === "expired"}>
                  {status === "expired" ? <TriangleAlert size={10} /> : <Clock size={10} />}
                  {status === "expired" ? `lapsed ${Math.abs(days)}d ago` : `${days}d left`}
                </Pill>
              )}

              {d.verifiedAt ? (
                <Pill color={P.green}><ShieldCheck size={10} />verified</Pill>
              ) : (
                /* Uploading is not verifying, and the difference matters when
                   somebody asks who confirmed this was real. */
                <Pill color={P.sub}>not checked</Pill>
              )}

              <span className="flex-1" />

              {d.locationHidden ? (
                <span className="inline-flex items-center gap-1" style={{ fontSize: 11.5, color: P.sub }}>
                  <Lock size={10} />location hidden
                </span>
              ) : /^https?:\/\//.test(d.location) ? (
                <a href={d.location} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1" style={{ fontSize: 11.5, color: P.petrol }}>
                  <ExternalLink size={10} />open
                </a>
              ) : (
                <span style={{ fontSize: 11.5, color: P.sub }}>{d.location}</span>
              )}

              {canWrite && !d.verifiedAt && <BtnGhost icon={ShieldCheck} onClick={() => verify(d.id)}>Verify</BtnGhost>}
              {canWrite && <BtnGhost color={P.brick} icon={X} onClick={() => voidDoc(d.id)}>Remove</BtnGhost>}
            </div>
          );
        })}
      </div>

      {!data.seesPointers && (
        <Muted>
          You can see what is on file and when it lapses. Where identity documents are kept is behind the same
          permission as bank details.
        </Muted>
      )}
    </Card>
  );
}

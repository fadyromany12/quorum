/* Tab B — the daily log. Form on the left, live verdict on the right; the
   verdict recomputes on every keystroke so the TL sees the consequence before
   committing to it. */

import { useMemo, useState } from "react";
import { ClipboardPlus } from "lucide-react";
import { Field, TInput, TSelect, Toggle, BtnPrimary, BtnGhost, Label } from "./ui/index.jsx";
import ViolationPicker from "./ViolationPicker.jsx";
import VerdictPanel from "./VerdictPanel.jsx";
import AgentSnapshot from "./AgentSnapshot.jsx";
import { P } from "../lib/tokens.js";
import { todayStr } from "../lib/dates.js";
import { uid } from "../lib/format.js";
import { verdictFor } from "../lib/engine.js";
import { agentSummary } from "../lib/agents.js";
import { agentMatches } from "../lib/identity.js";
import { LOBS } from "../lib/constants.js";

const blank = (accounts, tls, defaultAccount) => ({
  account: defaultAccount && defaultAccount !== "All" ? defaultAccount : accounts[0] || "",
  lob: "",
  date: todayStr(),
  email: "",
  empId: "",
  agentName: "",
  tl: tls[0] || "",
  shiftStart: "10:00",
  shiftEnd: "19:00",
  violation: "",
  sickNote: false,
  missH: 0,
  missM: 0,
  evidenceUrl: "",
  notes: "",
});

export default function LogForm({ data, onAdd, onCancel, defaultAccount }) {
  const [f, setF] = useState(() => blank(data.accounts, data.tls, defaultAccount));
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // Agents are matched by employee ID or email — either one identifies them.
  const agentRef = useMemo(() => ({ email: f.email.trim(), empId: f.empId.trim() }), [f.email, f.empId]);

  const verdict = useMemo(
    () => verdictFor(f.violation, agentRef, f.date, data.entries, data.dcm),
    [f.violation, agentRef, f.date, data.entries, data.dcm]
  );

  const known = useMemo(
    () => (agentRef.email || agentRef.empId ? data.entries.some((e) => agentMatches(e, agentRef)) : false),
    [data.entries, agentRef]
  );
  const summary = useMemo(
    () => (known ? agentSummary(data.entries, agentRef, f.date) : null),
    [known, data.entries, agentRef, f.date]
  );

  const valid = Boolean(f.account && f.date && (agentRef.email || agentRef.empId) && f.violation);

  const submit = () => {
    if (!valid) return;
    // Recomputed at submit rather than trusting the memo — `data.entries` may
    // have moved since the last render.
    const v = verdictFor(f.violation, agentRef, f.date, data.entries, data.dcm);

    onAdd({
      id: uid(),
      account: f.account,
      lob: f.lob,
      date: f.date,
      email: agentRef.email,
      empId: agentRef.empId,
      agentName: f.agentName.trim(),
      tl: f.tl,
      executorName: f.tl,
      tardyMin: 0,
      earlyMin: 0,
      compMin: 0,
      shiftStart: f.shiftStart,
      shiftEnd: f.shiftEnd,
      violation: f.violation,
      sickNote: f.sickNote,
      missingMin: (Number(f.missH) || 0) * 60 + (Number(f.missM) || 0),
      evidenceUrl: f.evidenceUrl.trim(),
      occurrence: v.occ,
      action: v.action,
      executor: v.executor,
      severity: v.severity,
      disciplinary: v.disciplinary,
      deductionDays: v.cap.prescribed,
      // Nothing is deducted until a manager escalates it, but the figure is
      // stored now so the case card and the CSV agree with the verdict shown.
      deductionApplied: v.cap.applied,
      reclassifiedFrom: v.reclassifiedFrom || "",
      notes: f.notes.trim(),
      stage: "review",
      assignee: "",
      activity: [],
      notified: false,
      opsConfirmed: false,
      hrNeeded: v.executor === "HR",
      hrConfirmed: false,
      hrRef: "",
      actionDate: "",
      createdAt: Date.now(),
    });

    setF((p) => ({ ...p, email: "", empId: "", agentName: "", violation: "", sickNote: false, missH: 0, missM: 0, evidenceUrl: "", notes: "" }));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* ── Left: the form ── */}
      <div className="p-4 md:p-5 ao-glass" style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 10 }}>
        <div className="ao-disp font-bold uppercase tracking-wide flex items-center gap-2" style={{ fontSize: 16, color: P.ink }}>
          <ClipboardPlus size={17} color={P.petrol} />
          Log violation / leave
        </div>
        <div className="mt-1" style={{ fontSize: 12.5, color: P.sub }}>
          New cases start as <b>Pending review</b> — a TL or direct manager must escalate or dismiss them with a comment
          before anything is deducted.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <Field label="Account">
            <TSelect value={f.account} onChange={(e) => set("account", e.target.value)}>
              {data.accounts.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </TSelect>
          </Field>
          <Field label="Date">
            <TInput type="date" max={todayStr()} value={f.date} onChange={(e) => set("date", e.target.value)} />
          </Field>
          <Field label="Agent email (or use ID)">
            <TInput
              type="text"
              placeholder="name@konecta.com"
              value={f.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Employee ID">
            <TInput type="text" placeholder="EG0000" value={f.empId} onChange={(e) => set("empId", e.target.value)} />
          </Field>
          <Field label="Agent name (optional)">
            <TInput type="text" placeholder="Nour Said" value={f.agentName} onChange={(e) => set("agentName", e.target.value)} />
          </Field>
          <Field label="Line of business">
            <TSelect value={f.lob} onChange={(e) => set("lob", e.target.value)}>
              <option value="">—</option>
              {LOBS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </TSelect>
          </Field>
          <Field label="Logged by (TL)">
            <TSelect value={f.tl} onChange={(e) => set("tl", e.target.value)}>
              {data.tls.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </TSelect>
          </Field>
          <Field label="Missing time">
            <div className="flex gap-2 items-center">
              <TInput type="number" min="0" value={f.missH} onChange={(e) => set("missH", e.target.value)} style={{ width: 70 }} />
              <span style={{ color: P.sub, fontSize: 13 }}>h</span>
              <TInput type="number" min="0" max="59" value={f.missM} onChange={(e) => set("missM", e.target.value)} style={{ width: 70 }} />
              <span style={{ color: P.sub, fontSize: 13 }}>m</span>
            </div>
          </Field>
          <Field label="Shift start">
            <TInput type="time" value={f.shiftStart} onChange={(e) => set("shiftStart", e.target.value)} />
          </Field>
          <Field label="Shift end">
            <TInput type="time" value={f.shiftEnd} onChange={(e) => set("shiftEnd", e.target.value)} />
          </Field>
        </div>

        <div className="mt-3">
          <Label>Violation / type</Label>
          <div className="mt-1">
            <ViolationPicker dcm={data.dcm} value={f.violation} onChange={(v) => set("violation", v)} />
          </div>
        </div>

        {(f.violation === "Sick Leave" || f.violation === "Fake sick leave") && (
          <div className="mt-3">
            <Label>Medical certificate attached?</Label>
            <div className="mt-1">
              <Toggle
                on={f.sickNote}
                label={f.sickNote ? "Certificate on file" : "No certificate"}
                onClick={() => set("sickNote", !f.sickNote)}
              />
            </div>
          </div>
        )}

        <div className="mt-3">
          <Field label="Evidence link / reference (optional)">
            <TInput
              type="text"
              placeholder="Call-recording ID, QA screenshot URL, certificate location…"
              value={f.evidenceUrl}
              onChange={(e) => set("evidenceUrl", e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Notes">
            <TInput
              type="text"
              placeholder="Context, HR case ref, warning letter no.…"
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>

        <div className="flex gap-3 mt-4 justify-end">
          <BtnGhost onClick={onCancel}>Close</BtnGhost>
          <BtnPrimary onClick={submit} disabled={!valid} title={valid ? "" : "Account, date, an agent email or ID, and a violation are required"}>
            Log entry
          </BtnPrimary>
        </div>
      </div>

      {/* ── Right: the live verdict ── */}
      <div className="grid gap-3 lg:sticky" style={{ top: 16 }}>
        {verdict ? (
          <VerdictPanel verdict={verdict} />
        ) : (
          <div
            className="p-6 text-center"
            style={{ background: P.card, border: `1px dashed ${P.line}`, borderRadius: 10 }}
          >
            <div className="ao-disp font-bold uppercase tracking-wide" style={{ fontSize: 14, color: P.sub }}>
              Live verdict
            </div>
            <div className="mt-2 mx-auto" style={{ fontSize: 13, color: P.sub, maxWidth: 320 }}>
              Pick an agent and a violation. The matrix will work out the occurrence number, the prescribed action and
              what payroll may legally deduct — before you commit the case.
            </div>
          </div>
        )}
        <AgentSnapshot summary={summary} known={known && !!summary} />
      </div>
    </div>
  );
}

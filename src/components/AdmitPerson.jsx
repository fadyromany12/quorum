"use client";

/* Admitting a person — the door onto the lifecycle.

   Deliberately small. The intake that matters at admission is who they are and
   where they sit; everything else (PII, banking, dependents) is collected later
   through its own gated flow, because the person filling this form rarely has
   the passport in front of them, and a long form gets half-filled and abandoned.

   Two entry stages only. "Applicant" is the safe default — a record that grants
   nothing until someone advances it. "Probation" is the direct-hire shortcut for
   someone who has already signed and is starting; it demands a hire date because
   probation without one has no end. */

import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { Card, BtnGhost, BtnPrimary, TInput, TSelect, Label } from "./ui/index.jsx";
import { P } from "../lib/tokens.js";
import { todayStr } from "../lib/dates.js";
import { displayName } from "../lib/employee.js";

export default function AdmitPerson({ accounts = [], onDone, onCancel }) {
  const [f, setF] = useState({
    fullNameEn: "", fullNameAr: "", workEmail: "", jobTitle: "",
    department: "Operations", account: accounts[0] || "", lob: "",
    stage: "Applicant", hireDate: "",
    directManagerId: "", functionalManagerId: "",
  });
  const [managers, setManagers] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  /* Manager pickers need more than the visible page of the directory — one
     bounded fetch of the working population, not a request per keystroke. */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/employees?pageSize=200");
        const json = await res.json().catch(() => ({}));
        if (res.ok) setManagers(json.employees || []);
      } catch { /* pickers degrade to empty; the form still submits */ }
    })();
  }, []);

  const directHire = f.stage !== "Applicant";
  const ready = f.fullNameEn.trim() && f.workEmail.trim() && (!directHire || f.hireDate);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f,
          directManagerId: f.directManagerId || null,
          functionalManagerId: f.functionalManagerId || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not create the record.");
      onDone(json.employee);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><UserPlus size={14} />Admit someone</span>}
      right={<BtnGhost onClick={onCancel} icon={X}>Cancel</BtnGhost>}
    >
      {error && <div className="mb-3" role="alert" style={{ fontSize: 13, color: P.brick }}>{error}</div>}

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <div className="grid gap-1">
          <Label>Full name (English) *</Label>
          <TInput value={f.fullNameEn} onChange={set("fullNameEn")} placeholder="As it will appear everywhere" />
        </div>
        <div className="grid gap-1">
          <Label>Full name (Arabic)</Label>
          <TInput dir="rtl" value={f.fullNameAr} onChange={set("fullNameAr")} placeholder="كما في البطاقة" />
        </div>
        <div className="grid gap-1">
          <Label>Work email *</Label>
          <TInput type="email" value={f.workEmail} onChange={set("workEmail")} placeholder="name@konecta.com" />
        </div>
        <div className="grid gap-1">
          <Label>Job title</Label>
          <TInput value={f.jobTitle} onChange={set("jobTitle")} placeholder="Customer Service Agent" />
        </div>
        <div className="grid gap-1">
          <Label>Department</Label>
          <TInput value={f.department} onChange={set("department")} />
        </div>
        <div className="grid gap-1">
          <Label>Account</Label>
          <TSelect value={f.account} onChange={set("account")}>
            <option value="">—</option>
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </TSelect>
        </div>
        <div className="grid gap-1">
          <Label>Direct manager</Label>
          <TSelect value={f.directManagerId} onChange={set("directManagerId")}>
            <option value="">— none yet —</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{displayName(m)} · {m.empId}</option>)}
          </TSelect>
        </div>
        <div className="grid gap-1">
          <Label>Functional manager</Label>
          <TSelect value={f.functionalManagerId} onChange={set("functionalManagerId")}>
            <option value="">— none —</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{displayName(m)} · {m.empId}</option>)}
          </TSelect>
        </div>
        <div className="grid gap-1">
          <Label>Entry stage</Label>
          <TSelect value={f.stage} onChange={set("stage")}>
            <option value="Applicant">Applicant — pending approval</option>
            <option value="Probation">Direct hire — starts on probation</option>
          </TSelect>
        </div>
        {directHire && (
          <div className="grid gap-1">
            <Label>Hire date *</Label>
            <TInput type="date" value={f.hireDate} max={todayStr()} onChange={set("hireDate")} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mt-4">
        <span style={{ fontSize: 11.5, color: P.sub }}>
          {directHire
            ? "Probation ends three months after the hire date; the record will carry its confirmation date from day one."
            : "An applicant grants nothing until someone advances them — the safe default."}
        </span>
        <span className="flex-1" />
        <BtnPrimary onClick={submit} disabled={busy || !ready}>
          <span className="inline-flex items-center gap-1.5"><UserPlus size={13} />Create the record</span>
        </BtnPrimary>
      </div>
    </Card>
  );
}

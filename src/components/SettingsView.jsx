/* Tab G — settings and utilities. */

import { useEffect, useState } from "react";
import { Download, DatabaseZap, TriangleAlert, Plus, X } from "lucide-react";
import { Card, TInput, BtnPrimary, BtnGhost, Muted } from "./ui/index.jsx";
import { P, alpha } from "../lib/tokens.js";
import { RESET_DAYS, PER_INCIDENT_CAP, PER_MONTH_CAP, EMERGENCY_QUOTA, LAW_CITATION } from "../lib/constants.js";
import { checkAccounts } from "../lib/org.js";
import { plural } from "../lib/format.js";

function ListEditor({ title, items, onChange, placeholder }) {
  const [val, setVal] = useState("");
  const add = () => {
    const v = val.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setVal("");
  };
  return (
    <Card title={title}>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <span
            key={it}
            className="inline-flex items-center gap-2"
            style={{ fontSize: 13, color: P.ink, background: P.mist, borderRadius: 999, padding: "4px 6px 4px 12px" }}
          >
            {it}
            <button
              onClick={() => onChange(items.filter((x) => x !== it))}
              aria-label={`Remove ${it}`}
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                border: "none",
                background: "var(--mist)",
                color: P.ink,
                cursor: "pointer",
                fontSize: 11,
                lineHeight: "18px",
              }}
            >
              ×
            </button>
          </span>
        ))}
        {items.length === 0 && <Muted>None yet.</Muted>}
      </div>
      <div className="flex gap-2 mt-3">
        <TInput value={val} placeholder={placeholder} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <BtnGhost onClick={add} icon={Plus}>
          Add
        </BtnGhost>
      </div>
    </Card>
  );
}


/* Accounts, with their lines of business nested underneath.

   A flat shared LOB list offered every account every line — Hertz was offered
   GTAP because Lenovo had it. Nesting them means the form can only ever produce
   a pairing the org actually has.

   Removal states its consequence before it happens. Deleting a line does not
   delete the people on it; it orphans them, and they disappear from every
   filtered view while staying on the payroll. */
function OrgEditor({ org, onChange }) {
  const [draft, setDraft] = useState(() => org.map((a) => ({ ...a, lobs: [...a.lobs] })));
  const [account, setAccount] = useState("");
  const [lob, setLob] = useState({});
  const [error, setError] = useState("");

  // A save elsewhere, or a first load, replaces what has not been edited.
  useEffect(() => { setDraft(org.map((a) => ({ ...a, lobs: [...a.lobs] }))); }, [org]);

  const commit = (next) => {
    const check = checkAccounts(next);
    if (!check.ok) { setError(check.reason); return; }
    setError("");
    setDraft(check.accounts);
    onChange(check.accounts);
  };

  const addAccount = () => {
    const name = account.trim();
    if (!name) return;
    const next = [...draft, { name, lobs: [] }];
    const check = checkAccounts(next);
    if (!check.ok) { setError(check.reason); return; }
    setAccount("");
    commit(next);
  };

  const addLob = (i) => {
    const v = (lob[i] ?? "").trim();
    if (!v) return;
    const next = draft.map((a, j) => (j === i ? { ...a, lobs: [...a.lobs, v] } : a));
    const check = checkAccounts(next);
    if (!check.ok) { setError(check.reason); return; }
    setLob((p) => ({ ...p, [i]: "" }));
    commit(next);
  };

  const removeLob = (i, l) =>
    commit(draft.map((a, j) => (j === i ? { ...a, lobs: a.lobs.filter((x) => x !== l) } : a)));
  const removeAccount = (i) => commit(draft.filter((_, j) => j !== i));

  return (
    <Card title="Accounts & lines of business">
      {error && <div className="mb-3" role="alert" style={{ fontSize: 12.5, color: P.brick }}>{error}</div>}

      <div className="grid gap-2.5">
        {draft.map((a, i) => (
          <div key={a.name} style={{ background: "var(--well)", border: `1px solid ${P.line}`, borderRadius: 12, padding: "11px 13px" }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontSize: 13, fontWeight: 600, color: P.ink }}>{a.name}</span>
              <span style={{ fontSize: 11, color: P.sub }}>
                {a.lobs.length ? plural(a.lobs.length, "line") : "no lines yet"}
              </span>
              <span className="flex-1" />
              <BtnGhost onClick={() => removeAccount(i)} icon={X}>Remove</BtnGhost>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {a.lobs.map((l) => (
                <span key={l} className="inline-flex items-center gap-1"
                  style={{ fontSize: 11.5, border: `1px solid ${P.line}`, background: P.card,
                           borderRadius: 999, padding: "3px 4px 3px 10px", color: P.inkSoft }}>
                  {l}
                  <button type="button" onClick={() => removeLob(i, l)} aria-label={`Remove ${l}`}
                    style={{ border: "none", background: "none", cursor: "pointer", color: P.sub, display: "flex", padding: 2 }}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                value={lob[i] ?? ""}
                onChange={(e) => setLob((p) => ({ ...p, [i]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLob(i))}
                placeholder="Add a line…"
                aria-label={`Add a line of business to ${a.name}`}
                style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 999, minWidth: 130,
                         border: `1px dashed ${P.line}`, background: "transparent", color: P.ink, outline: "none" }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <TInput
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAccount())}
          placeholder="e.g. Vodafone"
        />
        <BtnGhost onClick={addAccount} icon={Plus}>Add account</BtnGhost>
      </div>
    </Card>
  );
}

export default function SettingsView({ data, onAccounts, onTls, onReset, onExport, onLoadSamples }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <OrgEditor org={data.org ?? []} onChange={onAccounts} />
      <ListEditor title="Team leads / managers" items={data.tls} placeholder="Full name" onChange={onTls} />

      <Card title="Sample data">
        <Muted>
          Loads a demo ledger across all three accounts: a warning chain that resets after 90 days, a full 1st → 2nd →
          3rd progression, two NCNS in one month hitting the deduction cap, an exhausted emergency quota, and cases
          waiting at triage, OPS and HR.
        </Muted>
        <div className="mt-3">
          <BtnPrimary onClick={onLoadSamples} icon={DatabaseZap}>
            Load sample data
          </BtnPrimary>
        </div>
      </Card>

      <Card title="Weekly PMO export">
        <Muted>
          Downloads every case as CSV — agent, violation, calculated occurrence, prescribed vs collectable deduction,
          review comment and pipeline state.
        </Muted>
        <div className="mt-3">
          <BtnPrimary onClick={onExport} icon={Download}>
            Export CSV
          </BtnPrimary>
        </div>
      </Card>

      <Card title="Policy in force">
        <div className="grid gap-1.5" style={{ fontSize: 12.5, color: P.inkSoft }}>
          <Rule label="Warning reset">{RESET_DAYS} days from the previous occurrence of the same violation</Rule>
          <Rule label="Deduction cap">
            {PER_INCIDENT_CAP} days per incident · {PER_MONTH_CAP} days per calendar month
          </Rule>
          <Rule label="Emergency leave">{EMERGENCY_QUOTA} days a year · max 2 consecutive per month</Rule>
          <Rule label="Statute">{LAW_CITATION}</Rule>
          <Rule label="Matrix">{data.dcm.length} violations across 4 severity tiers</Rule>
        </div>
        <div className="mt-2" style={{ fontSize: 11.5, color: P.sub }}>
          Thresholds are compiled in. The matrix itself is editable on the DCM tab.
        </div>
      </Card>

      <Card title="Danger zone" accent={`${alpha(P.brick, 0.33)}`}>
        <div className="ao-disp font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ fontSize: 13, color: P.brick, marginTop: -8 }}>
          <TriangleAlert size={13} />
          Hard reset
        </div>
        <Muted>Erases every entry and restores the default accounts, team leads and matrix. This cannot be undone.</Muted>
        <div className="mt-3">
          <BtnGhost color={P.brick} onClick={onReset} icon={TriangleAlert}>
            Reset all data
          </BtnGhost>
        </div>
      </Card>
    </div>
  );
}

function Rule({ label, children }) {
  return (
    <div className="flex gap-2">
      <span className="ao-disp uppercase tracking-wider font-semibold" style={{ fontSize: 10.5, color: P.sub, width: 110, flexShrink: 0, paddingTop: 2 }}>
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}

/* Tab G — settings and utilities. */

import { useState } from "react";
import { Download, DatabaseZap, TriangleAlert, Plus } from "lucide-react";
import { Card, TInput, BtnPrimary, BtnGhost, Muted } from "./ui/index.jsx";
import { P, alpha } from "../lib/tokens.js";
import { RESET_DAYS, PER_INCIDENT_CAP, PER_MONTH_CAP, EMERGENCY_QUOTA, LAW_CITATION } from "../lib/constants.js";

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

export default function SettingsView({ data, onAccounts, onTls, onReset, onExport, onLoadSamples }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <ListEditor title="Accounts / projects" items={data.accounts} placeholder="e.g. Vodafone" onChange={onAccounts} />
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

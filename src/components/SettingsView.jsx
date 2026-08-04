/* Tab G — settings and utilities. */

import { useEffect, useState } from "react";
import { Download, DatabaseZap, TriangleAlert, Plus, X, Lock } from "lucide-react";
import { Card, TInput, BtnPrimary, BtnGhost, Muted, Field } from "./ui/index.jsx";
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

      <PayrollRates />

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

      <DangerZone onReset={onReset} />
    </div>
  );
}

/* The reset is switched off on deployments unless somebody armed it
   deliberately, so the button asks the server whether it would work before
   offering itself. A control that fails after you have confirmed it teaches
   you to click through the confirm dialog, which is the opposite of what a
   danger zone is for. */
function DangerZone({ onReset }) {
  const [gate, setGate] = useState(null);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/reset")
      .then((r) => (r.ok ? r.json() : null))
      .then((g) => live && setGate(g))
      .catch(() => {
        /* Unknown, so the button stays as it was: the server refuses anyway,
           and a network blip should not present a locked reset as available. */
      });
    return () => { live = false; };
  }, []);

  const off = gate !== null && gate.allowed === false;

  return (
    <Card title="Danger zone" accent={`${alpha(P.brick, 0.33)}`}>
      <div
        className="ao-disp font-bold uppercase tracking-wide flex items-center gap-1.5"
        style={{ fontSize: 13, color: off ? P.sub : P.brick, marginTop: -8 }}
      >
        {off ? <Lock size={13} /> : <TriangleAlert size={13} />}
        Hard reset
      </div>
      <Muted>Erases every entry and restores the default accounts, team leads and matrix. This cannot be undone.</Muted>

      {off ? (
        <div
          className="mt-3 p-3"
          style={{ background: "var(--wash)", border: `1px solid ${alpha(P.ink, 0.12)}`, borderRadius: 8, fontSize: 12.5, color: P.inkSoft }}
        >
          {gate.reason}
        </div>
      ) : (
        <div className="mt-3">
          <BtnGhost color={P.brick} onClick={onReset} icon={TriangleAlert}>
            Reset all data
          </BtnGhost>
          {gate?.environment && gate.environment !== "development" && (
            <Muted>
              Armed on this {gate.environment} deployment. Remove the switch once you are done.
            </Muted>
          )}
        </div>
      )}
    </Card>
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

/* Statutory payroll rates.

   Kept out of the config save above on purpose. Accounts and team leads are
   edited constantly and by several people; these two numbers change a few times
   a decade and change what every employee is paid. Sharing a save button would
   mean a routine edit to the account list could carry a stale tax rate back
   over a correct one.

   The fields take percentages because that is how finance says them out loud.
   That also makes the catchable mistake catchable: typing 11 in a field that
   wanted 0.11 is refused, and the uncatchable one — typing 0.11 meaning eleven
   per cent — is at least the direction that looks wrong on a payslip. */
function PayrollRates() {
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ socialInsurancePct: "", taxPct: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      const r = await fetch("/api/payroll");
      if (!r.ok) return;
      const j = await r.json();
      setState(j);
      setForm({
        socialInsurancePct: j.configured ? String(j.socialInsurancePct) : "",
        taxPct: j.configured ? String(j.taxPct) : "",
        note: j.note ?? "",
      });
    } catch { /* the card simply does not render its form */ }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/payroll", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          socialInsurancePct: Number(form.socialInsurancePct),
          taxPct: Number(form.taxPct),
          note: form.note,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "The rates were refused.");
      setState(j);
      setMessage("Saved. Payslips from now on will show both deductions.");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Payroll rates">
      <Muted>
        Social insurance and income tax are never assumed. Until both are set here, every payslip prints its earnings
        and absence deductions and states on its face that it is not a final net figure — rather than showing a zero
        that looks calculated.
      </Muted>

      {state && !state.canEdit && (
        <div className="mt-3" style={{ fontSize: 12.5, color: P.sub }}>
          {state.configured
            ? `Set to ${state.socialInsurancePct}% social insurance and ${state.taxPct}% income tax${state.updatedBy ? ` by ${state.updatedBy}` : ""}.`
            : "Not configured yet. A Super Admin can set these."}
        </div>
      )}

      {state?.canEdit && (
        <>
          <div className="grid gap-2 md:grid-cols-3 mt-3">
            <Field label="Social insurance %">
              <TInput
                value={form.socialInsurancePct}
                onChange={(e) => setForm({ ...form, socialInsurancePct: e.target.value })}
                placeholder="11"
                inputMode="decimal"
              />
            </Field>
            <Field label="Income tax %">
              <TInput
                value={form.taxPct}
                onChange={(e) => setForm({ ...form, taxPct: e.target.value })}
                placeholder="10"
                inputMode="decimal"
              />
            </Field>
            <Field label="Note (optional)">
              <TInput
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Source and date of these rates"
              />
            </Field>
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-3">
            <BtnPrimary onClick={save} disabled={busy || form.socialInsurancePct === "" || form.taxPct === ""}>
              Save rates
            </BtnPrimary>
            {state.configured && state.updatedBy && (
              <Muted>Last set by {state.updatedBy}{state.updatedAt ? ` on ${String(state.updatedAt).slice(0, 10)}` : ""}.</Muted>
            )}
            {message && <span style={{ fontSize: 12.5, color: P.inkSoft }}>{message}</span>}
          </div>
          <Muted>
            Enter 11 for eleven per cent. These come from your finance team, not from this system — nothing here
            invents a rate.
          </Muted>
        </>
      )}
    </Card>
  );
}

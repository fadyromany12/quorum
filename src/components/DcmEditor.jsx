/* Tab F — the matrix itself, editable.

   Whatever is saved here drives every verdict from the next keystroke on. The
   engine reads the stored matrix, never the hardcoded default, so an admin can
   change procedure without a deploy. */

import { useMemo, useState } from "react";
import { Plus, Trash2, Search, RotateCcw } from "lucide-react";
import { TInput, TSelect, BtnGhost, Pill, Muted } from "./ui/index.jsx";
import { P, SEV_ORDER, sevColor } from "../lib/tokens.js";
import { uid, ordinal, days } from "../lib/format.js";
import { newRule, DEFAULT_DCM } from "../lib/dcm.js";
import { deductionDaysOf } from "../lib/deductions.js";
import { RESET_DAYS, PER_INCIDENT_CAP } from "../lib/constants.js";

export default function DcmEditor({ dcm, onChange }) {
  const [q, setQ] = useState("");

  const patch = (id, k, v) => onChange(dcm.map((r) => (r.id === id ? { ...r, [k]: v } : r)));
  const remove = (id) => {
    if (window.confirm("Remove this rule? Cases already logged keep the action they were given.")) {
      onChange(dcm.filter((r) => r.id !== id));
    }
  };
  const add = () => onChange([...dcm, newRule(uid())]);
  const restore = () => {
    if (window.confirm("Discard all edits and restore the default 35-violation matrix?")) onChange(DEFAULT_DCM);
  };

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => (needle ? dcm.filter((r) => r.name.toLowerCase().includes(needle)) : dcm), [dcm, needle]);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div style={{ fontSize: 13, color: P.sub, maxWidth: 620 }}>
          Lenovo Disciplinary Consequences Matrix v1.0 (HR-EG-DIS-001, effective 21 Apr 2026). Occurrences are counted
          per agent per violation inside the {RESET_DAYS}-day reset window; the matching action and executor apply when a
          case is logged. Deductions above {PER_INCIDENT_CAP} days are cut to the statutory ceiling at verdict time.
        </div>
        <div className="flex gap-2 flex-wrap">
          <BtnGhost onClick={restore} icon={RotateCcw}>
            Restore defaults
          </BtnGhost>
          <BtnGhost onClick={add} icon={Plus}>
            Add rule
          </BtnGhost>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3" style={{ maxWidth: 320 }}>
        <div
          className="flex items-center gap-2 flex-1"
          style={{ border: `1px solid ${P.line}`, background: "var(--well)", borderRadius: 6, padding: "6px 10px" }}
        >
          <Search size={14} color={P.sub} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter violations…"
            style={{ border: "none", background: "transparent", outline: "none", fontSize: 13.5, color: P.ink, flex: 1, minWidth: 0 }}
          />
        </div>
        <span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>
          {filtered.length}/{dcm.length}
        </span>
      </div>

      {filtered.length === 0 && (
        <div className="mt-4">
          <Muted>Nothing matches “{q}”.</Muted>
        </div>
      )}

      {SEV_ORDER.map((s) => {
        const rules = filtered.filter((r) => r.severity === s);
        if (!rules.length) return null;
        return (
          <div key={s} className="mt-5">
            <div className="flex items-center gap-2">
              <span style={{ width: 10, height: 10, borderRadius: 2, background: sevColor(s), display: "inline-block" }} />
              <span className="ao-disp font-bold uppercase tracking-wide" style={{ fontSize: 14, color: P.ink }}>
                {s}
              </span>
              <span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>
                ({rules.length})
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="flex ao-glass"
                  style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 10, overflow: "hidden" }}
                >
                  <div style={{ width: 5, background: sevColor(r.severity), flexShrink: 0 }} />
                  <div className="p-4 flex-1 min-w-0 grid gap-2">
                    <div className="flex gap-2">
                      <TInput value={r.name} onChange={(e) => patch(r.id, "name", e.target.value)} style={{ fontWeight: 600 }} />
                      <TSelect
                        value={r.severity}
                        onChange={(e) => patch(r.id, "severity", e.target.value)}
                        style={{ width: 130, flexShrink: 0 }}
                      >
                        {SEV_ORDER.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </TSelect>
                    </div>
                    {[1, 2, 3].map((n) => (
                      <OccRow key={n} r={r} n={n} patch={patch} />
                    ))}
                    <div className="flex justify-end">
                      <button
                        onClick={() => remove(r.id)}
                        className="inline-flex items-center gap-1"
                        style={{ fontSize: 12, color: P.sub, background: "none", border: "none", cursor: "pointer" }}
                      >
                        <Trash2 size={12} />
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OccRow({ r, n, patch }) {
  const action = r["a" + n];
  const ded = deductionDaysOf(action);
  const over = ded > PER_INCIDENT_CAP;

  return (
    <div className="flex gap-2 items-center">
      <span className="ao-mono" style={{ fontSize: 11, color: P.sub, width: 28, flexShrink: 0 }}>
        {ordinal(n)}
      </span>
      <TInput
        value={action}
        placeholder="—"
        onChange={(e) => patch(r.id, "a" + n, e.target.value)}
        style={{ fontSize: 13, padding: "6px 8px" }}
      />
      {over && (
        <Pill color={P.amber} title={`Exceeds the ${PER_INCIDENT_CAP}-day statutory ceiling — will be capped`}>
          {days(ded)}
        </Pill>
      )}
      <TSelect
        value={r["e" + n]}
        onChange={(e) => patch(r.id, "e" + n, e.target.value)}
        style={{ width: 76, fontSize: 13, padding: "6px 8px", flexShrink: 0 }}
      >
        <option value=""></option>
        <option>TL</option>
        <option>HR</option>
      </TSelect>
    </div>
  );
}

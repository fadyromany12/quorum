/* Searchable violation selector.

   35 matrix rows plus the leave types is far too many for a plain <select> —
   the TL needs to type "ncns" and get there. Grouped by severity tier so the
   consequence is legible before the pick is made. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, X } from "lucide-react";
import { P, SEV_ORDER, sevColor } from "../lib/tokens.js";
import { LEAVE_TYPES } from "../lib/constants.js";

const TIER_LABEL = {
  Minor: "Green · Minor",
  Moderate: "Yellow · Moderate",
  Serious: "Red · Serious",
  "Zero Tolerance": "Black · Zero Tolerance",
};

export default function ViolationPicker({ dcm, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef(null);
  const listRef = useRef(null);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (name) => !needle || name.toLowerCase().includes(needle);
    const out = SEV_ORDER.map((s) => ({
      key: s,
      label: TIER_LABEL[s],
      color: sevColor(s),
      items: dcm.filter((r) => r.severity === s && match(r.name)).map((r) => ({ name: r.name, hint: r.a1 })),
    })).filter((g) => g.items.length);

    const leave = LEAVE_TYPES.filter(match).map((t) => ({ name: t, hint: "Approved leave" }));
    if (leave.length) out.push({ key: "leave", label: "Leave / excused", color: P.green, items: leave });
    return out;
  }, [dcm, q]);

  // One flat list behind the groups, so the arrow keys can walk it.
  const flat = useMemo(() => groups.flatMap((g) => g.items.map((i) => ({ ...i, color: g.color }))), [groups]);

  useEffect(() => setCursor(0), [q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${cursor}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  const pick = (name) => {
    onChange(name);
    setQ("");
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      setCursor((c) => {
        const n = e.key === "ArrowDown" ? c + 1 : c - 1;
        return Math.max(0, Math.min(flat.length - 1, n));
      });
    } else if (e.key === "Enter") {
      if (open && flat[cursor]) {
        e.preventDefault();
        pick(flat[cursor].name);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQ("");
    }
  };

  const selectedColor = useMemo(() => {
    const rule = dcm.find((r) => r.name === value);
    return rule ? sevColor(rule.severity) : value ? P.green : P.line;
  }, [dcm, value]);

  let idx = -1;

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <div
        className="flex items-center gap-2"
        style={{
          border: `1px solid ${open ? P.petrol : P.line}`,
          background: "var(--well)",
          borderRadius: 6,
          padding: "8px 10px",
        }}
      >
        {value && !open ? (
          <span style={{ width: 8, height: 8, borderRadius: 2, background: selectedColor, flexShrink: 0 }} />
        ) : (
          <Search size={14} color={P.sub} style={{ flexShrink: 0 }} />
        )}
        <input
          value={open ? q : value || ""}
          placeholder={value ? value : `Search ${dcm.length} violations or leave types…`}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls="violation-listbox"
          style={{ border: "none", background: "transparent", outline: "none", fontSize: 14, color: P.ink, flex: 1, minWidth: 0 }}
        />
        {value && (
          <button
            onClick={() => pick("")}
            aria-label="Clear violation"
            style={{ border: "none", background: "none", cursor: "pointer", color: P.sub, display: "flex" }}
          >
            <X size={14} />
          </button>
        )}
        <ChevronDown size={14} color={P.sub} style={{ flexShrink: 0 }} />
      </div>

      {open && (
        <div
          id="violation-listbox"
          role="listbox"
          ref={listRef}
          style={{
            position: "absolute",
            zIndex: 30,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 320,
            overflowY: "auto",
            // Floats over content, so it can't be see-through like the cards.
            background: "var(--overlay)",
            backdropFilter: "blur(var(--glass-blur))",
            border: `1px solid ${P.line}`,
            borderRadius: 8,
            boxShadow: "var(--elev-3)",
          }}
        >
          {flat.length === 0 && (
            <div className="p-3" style={{ fontSize: 13, color: P.sub }}>
              Nothing matches “{q}”.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.key}>
              <div
                className="ao-disp uppercase tracking-wider font-semibold flex items-center gap-2 px-3 py-1.5"
                style={{ fontSize: 10.5, color: P.sub, background: P.mist, position: "sticky", top: 0 }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color }} />
                {g.label}
                <span className="ao-mono">({g.items.length})</span>
              </div>
              {g.items.map((it) => {
                idx++;
                const active = idx === cursor;
                const chosen = it.name === value;
                return (
                  <button
                    key={it.name}
                    data-idx={idx}
                    role="option"
                    aria-selected={chosen}
                    onMouseEnter={((n) => () => setCursor(n))(idx)}
                    onClick={() => pick(it.name)}
                    className="w-full text-left flex items-center gap-2 px-3 py-2"
                    style={{
                      border: "none",
                      cursor: "pointer",
                      background: active ? P.mist : "transparent",
                      borderLeft: `3px solid ${chosen ? g.color : "transparent"}`,
                    }}
                  >
                    <span className="truncate" style={{ fontSize: 13.5, color: P.ink, flex: 1 }}>
                      {it.name}
                    </span>
                    <span className="ao-mono truncate" style={{ fontSize: 11, color: P.sub, maxWidth: "45%" }}>
                      {it.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

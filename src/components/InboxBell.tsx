"use client";

/* What is waiting on you, in the header.

   The app was entirely pull before this: approvals sat in a queue, signatures
   sat unsigned, and noticing was a habit rather than a feature. The bell makes
   the queue visible from wherever you are.

   There is no read/unread, because there is nothing to mark read — every item
   is derived from work that still needs doing, so it leaves when the work is
   done rather than when someone glanced at it. That is a deliberate shape, not
   a missing feature: "3 approvals waiting" is a more useful sentence than
   "3 unread", and a count that only goes down when the work goes away cannot
   drift from the screens it links to.

   Polls rather than pushes. A websocket for a number that changes a few times
   an hour is a connection to keep alive, reconnect and reason about for no
   gain; a poll on an interval is a fetch that fails harmlessly. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, ChevronRight } from "lucide-react";

type Item = { kind: string; label: string; tab: string | null; count: number; detail?: string };

/** How often to re-ask. Long enough to be invisible, short enough that a
    decision made on another screen is reflected before it is forgotten. */
const POLL_MS = 60_000;

export default function InboxBell({ onGo }: { onGo?: (tab: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox");
      if (!res.ok) return; // a failed poll is not worth a message
      const j = await res.json();
      setItems(j.items ?? []);
      setTotal(j.total ?? 0);
    } catch {
      /* Offline or mid-deploy. The next tick will pick it up; showing an error
         in a header ornament would be louder than the problem. */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Click outside and Escape both close it, the way every menu should.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); load(); }}
        aria-label={total ? `${total} things waiting on you` : "Nothing waiting on you"}
        aria-expanded={open}
        title={total ? `${total} waiting on you` : "Nothing waiting on you"}
        className="ao-glow inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition"
        style={{ borderColor: "var(--line)", background: "var(--card)", color: "var(--ink-soft)", position: "relative" }}
      >
        <Bell size={13} />
        {total > 0 && (
          <span
            className="ao-mono"
            style={{
              background: "var(--brick)", color: "#fff", borderRadius: 999,
              fontSize: 10, lineHeight: 1, padding: "3px 6px", fontWeight: 700,
            }}
          >
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="ao-glass ao-pop"
          style={{
            position: "absolute", insetInlineEnd: 0, top: "calc(100% + 8px)", zIndex: 60,
            minWidth: 280, maxWidth: 340, padding: 8,
            background: "var(--deep)", border: "1px solid var(--line)", borderRadius: 12,
          }}
        >
          {items.length === 0 ? (
            <div style={{ padding: 10, fontSize: 12.5, color: "var(--sub)" }}>
              Nothing is waiting on you.
            </div>
          ) : (
            items.map((i) => {
              const clickable = !!(i.tab && onGo);
              return (
                <button
                  key={i.kind}
                  type="button"
                  role="menuitem"
                  disabled={!clickable}
                  onClick={() => { if (i.tab && onGo) { onGo(i.tab); setOpen(false); } }}
                  className="w-full transition"
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                    borderRadius: 8, border: "none", background: "transparent",
                    textAlign: "start", cursor: clickable ? "pointer" : "default",
                  }}
                >
                  <span
                    className="ao-mono"
                    style={{
                      minWidth: 26, textAlign: "center", fontWeight: 700, fontSize: 12,
                      color: "var(--brick)",
                    }}
                  >
                    {i.count}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, color: "var(--ink)" }}>{i.label}</span>
                    {i.detail && (
                      <span style={{ display: "block", fontSize: 11, color: "var(--sub)" }}>{i.detail}</span>
                    )}
                  </span>
                  {clickable && <ChevronRight size={13} style={{ color: "var(--sub)", flexShrink: 0 }} />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

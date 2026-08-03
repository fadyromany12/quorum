"use client";

/* "What can I actually do here?" — answered once, on the first visit.

   Two things this deliberately is not:

     1. It is not a tour. A sequence of tooltips that walks you round the screen
        blocks the work you opened the app to do, and everyone clicks "skip" on
        the second step. This is one page, readable in twenty seconds, closed
        with Escape.

     2. It is not written per role. The list comes from guide.js, which derives
        it from the same permission maps the API enforces with, so it cannot
        promise a Project Manager something the server would refuse.

   The dialog is the browser's own <dialog showModal()>, not a div with a high
   z-index. Focus trapping, Escape, returning focus to whatever opened it, and
   making the page behind inert are all things it does correctly and a
   hand-rolled modal usually does not. */

import { useEffect, useRef } from "react";
import {
  LayoutDashboard,
  UserPlus,
  MonitorPlay,
  TrendingUp,
  UserMinus,
  IdCard,
  Settings2,
  CircleUserRound,
  X,
  Compass,
} from "lucide-react";

import { groupedGuideFor, guideTitle, ROLE_PURPOSE } from "../lib/guide.js";
import { P } from "../lib/tokens.js";

const SECTION_ICON = {
  overview: LayoutDashboard,
  join: UserPlus,
  work: MonitorPlay,
  grow: TrendingUp,
  leave: UserMinus,
  records: IdCard,
  setup: Settings2,
  portal: CircleUserRound,
};

export default function GuideDialog({ role, open, onClose }) {
  const ref = useRef(null);

  /* showModal() throws if the dialog is already open, and close() on a closed
     dialog is a no-op — so both are guarded rather than assumed. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Escape and the backdrop both fire `close` natively; the parent hears about
  // every dismissal through one path rather than three.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => onClose?.();
    el.addEventListener("close", handler);
    return () => el.removeEventListener("close", handler);
  }, [onClose]);

  const groups = groupedGuideFor(role);

  return (
    <dialog
      ref={ref}
      className="ao-dialog"
      aria-labelledby="ao-guide-title"
      /* Clicking the backdrop lands on the <dialog> element itself; clicking
         anything inside lands on a child. */
      onClick={(e) => {
        if (e.target === ref.current) ref.current.close();
      }}
    >
      <header className="flex items-start gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${P.line}`, flexShrink: 0 }}>
        <span
          className="flex items-center justify-center"
          style={{ width: 34, height: 34, borderRadius: 10, background: "var(--signal-soft)", color: P.signal, flexShrink: 0 }}
        >
          <Compass size={17} />
        </span>
        <div className="flex-1 min-w-0">
          <h2 id="ao-guide-title" className="ao-disp font-semibold" style={{ fontSize: 16, lineHeight: 1.3 }}>
            {guideTitle(role)}
          </h2>
          <p style={{ fontSize: 12.5, color: P.sub, marginTop: 3, lineHeight: 1.45 }}>
            {ROLE_PURPOSE[role] ?? "Everything below is something your role can actually do."}
          </p>
        </div>
        <button
          onClick={() => ref.current?.close()}
          aria-label="Close"
          style={{ border: `1px solid ${P.line}`, background: "transparent", color: P.sub, borderRadius: 7, padding: 6, cursor: "pointer", display: "flex" }}
        >
          <X size={14} />
        </button>
      </header>

      <div className="ao-dialog-scroll px-5 py-4 grid gap-4">
        {groups.map((g, gi) => {
          const Icon = SECTION_ICON[g.id] ?? Compass;
          return (
            <section key={g.id} className="ao-rise" style={{ animationDelay: `${Math.min(gi, 6) * 45}ms` }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                <Icon size={13} color={P.signal} />
                <span className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 10, letterSpacing: 0.9, color: P.sub }}>
                  {g.group}
                </span>
              </div>
              <ul className="grid gap-1.5" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {g.items.map((it) => (
                  <li
                    key={it.what}
                    className="flex items-baseline gap-3 px-3 py-2"
                    style={{ background: "var(--mist)", borderRadius: 9 }}
                  >
                    <span style={{ fontSize: 13, color: P.ink, lineHeight: 1.45, flex: 1 }}>{it.what}</span>
                    {/* Where to go, unless the group heading has already said it —
                        an agent does not need "Your portal" written five times. */}
                    {it.where === g.group ? null : (
                      <span className="ao-mono" style={{ fontSize: 10.5, color: P.sub, whiteSpace: "nowrap" }}>
                        {it.where}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <footer className="flex items-center gap-3 px-5 py-3" style={{ borderTop: `1px solid ${P.line}`, flexShrink: 0 }}>
        <span style={{ fontSize: 11.5, color: P.sub, flex: 1 }}>
          This list is generated from your permissions, so it only shows what you can genuinely reach. Reopen it any
          time from the header.
        </span>
        <button
          onClick={() => ref.current?.close()}
          className="ao-disp font-semibold ao-glow"
          style={{
            border: "none",
            background: P.signal,
            color: "#fff",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 12.5,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Got it
        </button>
      </footer>
    </dialog>
  );
}

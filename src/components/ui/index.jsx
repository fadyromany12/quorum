/* Shared primitives. Structural pattern follows shadcn/ui — small, unstyled-by-
   default building blocks composed by feature components — but the styling is
   the tracker's own Konecta palette rather than shadcn's theme. */

import { Check } from "lucide-react";
import { P } from "../../lib/tokens.js";
import Tip from "./Tip.jsx";

export const Label = ({ children }) => (
  <div className="ao-disp uppercase tracking-wider font-semibold" style={{ fontSize: 11, color: P.sub }}>
    {children}
  </div>
);

export const Field = ({ label, children, span }) => (
  <div className={span ? "md:col-span-2" : ""}>
    <Label>{label}</Label>
    <div className="mt-1">{children}</div>
  </div>
);

const inputStyle = {
  border: `1px solid ${P.line}`,
  background: "var(--well)",
  color: P.ink,
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
  width: "100%",
};

export const TInput = ({ style, ...props }) => <input {...props} style={{ ...inputStyle, ...style }} />;
export const TSelect = ({ style, ...props }) => <select {...props} style={{ ...inputStyle, ...style }} />;
export const TArea = ({ style, ...props }) => (
  <textarea {...props} style={{ ...inputStyle, minHeight: 64, resize: "vertical", ...style }} />
);

/* A status badge. `title` is what the badge *means* — a pill reading "M2" tells
   nobody anything on its own — and it becomes a hover explanation rather than
   the browser's native tooltip, which waits too long for anyone to find it.
   The same text is repeated for screen readers, which never see the bubble. */
export const Pill = ({ color, children, filled, title }) => (
  <Tip label={title}>
    <span
      className="ao-disp uppercase tracking-wide font-semibold inline-flex items-center"
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 999,
        color: filled ? "#fff" : color,
        background: filled ? color : "transparent",
        border: `1px solid ${color}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
      {title ? <span className="sr-only"> — {title}</span> : null}
    </span>
  </Tip>
);

/* Pipeline steps: ticking one pops the check in, so completing a stage feels
   like an action rather than a repaint. */
export const Toggle = ({ on, label, onClick, disabledLook, title }) => (
  <button
    onClick={onClick}
    title={title}
    className={`ao-disp uppercase tracking-wide font-semibold transition inline-flex items-center gap-1 ${
      disabledLook ? "" : "ao-glow"
    }`}
    style={{
      fontSize: 11,
      padding: "4px 10px",
      borderRadius: 6,
      cursor: "pointer",
      color: on ? "#fff" : disabledLook ? "var(--disabled)" : P.sub,
      background: on ? P.green : "transparent",
      border: `1px ${disabledLook && !on ? "dashed" : "solid"} ${on ? P.green : P.line}`,
      "--glow": on ? P.green : "color-mix(in srgb, var(--signal) 55%, transparent)",
    }}
  >
    {on && <Check size={12} strokeWidth={3} className="ao-pop" />}
    {label}
  </button>
);

/* Primary actions carry the Signal: a light sweep on hover, a matching glow,
   and an icon that leans into the press. */
export const BtnPrimary = ({ children, onClick, disabled, bg, title, icon: Icon }) => {
  const tone = bg || P.petrol;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`ao-disp uppercase tracking-wider font-semibold transition inline-flex items-center gap-2 group ${
        disabled ? "" : "ao-sheen ao-glow"
      }`}
      style={{
        fontSize: 13,
        padding: "10px 18px",
        borderRadius: 6,
        color: "#fff",
        background: disabled ? "color-mix(in srgb, var(--signal) 35%, transparent)" : tone,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        "--glow": tone,
      }}
    >
      {Icon && <Icon size={14} className="transition-transform duration-200 group-hover:scale-110" />}
      {children}
    </button>
  );
};

export const BtnGhost = ({ children, onClick, color, disabled, title, icon: Icon }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`ao-disp uppercase tracking-wider font-semibold transition inline-flex items-center gap-2 group ${
      disabled ? "" : "ao-glow"
    }`}
    style={{
      fontSize: 13,
      padding: "10px 16px",
      borderRadius: 6,
      color: disabled ? "var(--disabled)" : color || P.inkSoft,
      background: "transparent",
      border: `1px solid ${P.line}`,
      cursor: disabled ? "default" : "pointer",
      "--glow": color || "color-mix(in srgb, var(--signal) 60%, transparent)",
    }}
  >
    {Icon && <Icon size={14} className="transition-transform duration-200 group-hover:scale-110" />}
    {children}
  </button>
);

export const Card = ({ title, children, right, accent }) => (
  <section
    className="p-4 ao-glass ao-lift"
    style={{ background: P.card, border: `1px solid ${accent || P.line}`, borderRadius: 12 }}
  >
    {/* Wraps, and both halves may shrink.

        Nearly every card puts a cluster of controls in `right` — a count, a
        date, an account filter, Refresh — and on a phone that cluster is wider
        than the screen. A non-wrapping flex row with unshrinkable children does
        not clip, it pushes: the whole page gained 28 to 167 pixels of sideways
        scroll on almost every tab, so reading anything on a phone meant nudging
        the page back left first.

        min-width: 0 is the other half of it. A flex child defaults to
        min-width: auto and refuses to go below its content width, which is why
        `flex-wrap` alone leaves a long title doing the same thing. */}
    {(title || right) && (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="ao-disp font-bold uppercase tracking-wide min-w-0" style={{ fontSize: 13, color: P.sub }}>
          {title}
        </h2>
        {right && <div className="min-w-0 max-w-full">{right}</div>}
      </div>
    )}
    <div className={title || right ? "mt-3" : ""}>{children}</div>
  </section>
);

export const SectionTitle = ({ children, count, tone }) => (
  <h2 className="ao-disp font-bold uppercase tracking-wide mb-2 flex items-center gap-2" style={{ fontSize: 14, color: P.ink }}>
    {children}
    {count !== undefined && (
      <span className="ao-mono" style={{ color: tone || P.petrol }}>
        ({count})
      </span>
    )}
  </h2>
);

export const Muted = ({ children }) => <div style={{ fontSize: 13, color: P.sub }}>{children}</div>;

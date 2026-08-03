"use client";

/* The glass kit — the foundation of the dark frosted aesthetic.
   Every surface is translucent white over the aurora background painted by
   globals.css: bg-[color:var(--mist)] + backdrop-blur + a hairline white/10 border, lifted
   by a soft dark drop shadow. Accents: emerald (positive), amber (caution),
   rose (destructive/serious), violet (priority). */

/* Theme-aware by necessity, not by preference.

   This kit was written for the dark shell and used slate-100 through slate-500
   throughout, which is correct on dark and near-invisible on light. The light
   theme arrived afterwards and nothing here was revisited, so an agent whose
   phone is in light mode could not read their own portal — their leave balance,
   their warnings, their payslip. Colours now follow the same CSS variables the
   rest of the app themes with, so both modes are legible and neither is a
   special case. */

import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";
import { X, LoaderCircle } from "lucide-react";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/* ── GlassCard ───────────────────────────────────────────────────────────── */

export function GlassCard({
  title,
  right,
  glow,
  className,
  children,
}: {
  title?: ReactNode;
  right?: ReactNode;
  /** Optional colored ambient glow behind the card. */
  glow?: "emerald" | "amber" | "rose" | "violet";
  className?: string;
  children: ReactNode;
}) {
  const glows = {
    emerald: "shadow-[0_0_40px_-12px_rgba(16,185,129,0.45)]",
    amber: "shadow-[0_0_40px_-12px_rgba(245,158,11,0.45)]",
    rose: "shadow-[0_0_40px_-12px_rgba(244,63,94,0.45)]",
    violet: "shadow-[0_0_40px_-12px_rgba(139,92,246,0.5)]",
  } as const;
  return (
    <section
      className={cx(
        "ao-rise rounded-2xl border border-[color:var(--line)] bg-[color:var(--mist)] backdrop-blur-xl",
        glow ? glows[glow] : "shadow-[0_8px_32px_rgba(2,6,23,0.45)]",
        "p-5",
        className
      )}
    >
      {(title || right) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">{title}</h2>
          )}
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/* ── GlassButton ─────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "ghost" | "danger" | "violet";

export function GlassButton({
  variant = "primary",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  const variants: Record<ButtonVariant, string> = {
    primary:
      "border-violet-400/30 bg-violet-500/15 text-[color:var(--signal)] hover:bg-violet-500/25 shadow-[0_0_24px_-8px_rgba(139,92,246,0.6)]",
    violet:
      "border-violet-400/30 bg-violet-500/15 text-[color:var(--signal)] hover:bg-violet-500/25 shadow-[0_0_24px_-8px_rgba(139,92,246,0.6)]",
    danger:
      "border-rose-400/30 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 shadow-[0_0_24px_-8px_rgba(244,63,94,0.6)]",
    ghost: "border-[color:var(--line)] bg-[color:var(--mist)] text-[color:var(--ink)] hover:bg-[color:var(--mist)]",
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5",
        "text-[13px] font-semibold uppercase tracking-wider backdrop-blur-md transition",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400/70",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none",
        variants[variant],
        className
      )}
    >
      {loading && <LoaderCircle size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ── GlassInput / GlassSelect ────────────────────────────────────────────── */

export function GlassLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[color:var(--sub)]">
      {children}
    </label>
  );
}

const fieldBase =
  "w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--mist)] px-3.5 py-2.5 text-[14px] text-[color:var(--ink)] " +
  "placeholder:text-[color:var(--sub)] backdrop-blur-md transition " +
  "focus:border-violet-400/40 focus:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-violet-400/20";

export function GlassInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(fieldBase, className)} />;
}

export function GlassSelect({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(fieldBase, "[&>option]:bg-slate-900 [&>option]:text-[color:var(--ink)]", className)}>
      {children}
    </select>
  );
}

/* ── GlassBadge ──────────────────────────────────────────────────────────── */

export function GlassBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "emerald" | "amber" | "rose" | "violet";
  children: ReactNode;
}) {
  const tones = {
    neutral: "border-[color:var(--line)] bg-[color:var(--mist)] text-[color:var(--ink)]",
    emerald: "border-emerald-400/30 bg-emerald-500/15 text-emerald-200",
    amber: "border-amber-400/30 bg-amber-500/15 text-amber-200",
    rose: "border-rose-400/30 bg-rose-500/15 text-rose-200",
    violet: "border-violet-400/30 bg-violet-500/15 text-[color:var(--signal)]",
  } as const;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5",
        "text-[11px] font-semibold uppercase tracking-wide backdrop-blur-md",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

/* ── GlassStat ───────────────────────────────────────────────────────────── */

export function GlassStat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "emerald" | "amber" | "rose" | "violet";
}) {
  const valueTones = {
    neutral: "text-[color:var(--ink)]",
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    rose: "text-rose-300",
    violet: "text-[color:var(--signal)]",
  } as const;
  return (
    <div className="ao-rise ao-lift rounded-2xl border border-[color:var(--line)] bg-[color:var(--mist)] p-4 backdrop-blur-xl">
      <div className={cx("font-mono text-2xl font-semibold leading-none", valueTones[tone])}>{value}</div>
      <div className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[color:var(--sub)]">{label}</div>
      {hint && <div className="mt-1 text-[11.5px] text-[color:var(--sub)]">{hint}</div>}
    </div>
  );
}

/* ── GlassProgress ───────────────────────────────────────────────────────── */

export function GlassProgress({ value, max, tone = "emerald" }: { value: number; max: number; tone?: "emerald" | "amber" | "rose" | "violet" }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  const bars = {
    emerald: "bg-emerald-400/80",
    amber: "bg-amber-400/80",
    rose: "bg-rose-400/80",
    violet: "bg-violet-400/80",
  } as const;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full border border-[color:var(--line)] bg-[color:var(--mist)]" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={cx("h-full rounded-full transition-all", bars[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ── GlassModal ──────────────────────────────────────────────────────────── */

export function GlassModal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    // Move focus into the dialog so keyboard users land inside it.
    panelRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ao-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cx(
          "ao-pop max-h-[88vh] w-full overflow-y-auto rounded-2xl border border-[color:var(--line)] bg-slate-900/70",
          "p-6 shadow-[0_24px_80px_rgba(2,6,23,0.7)] backdrop-blur-2xl outline-none",
          wide ? "max-w-2xl" : "max-w-lg"
        )}
      >
        <header className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-[15px] font-bold uppercase tracking-wider text-[color:var(--ink)]">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg border border-[color:var(--line)] bg-[color:var(--mist)] p-1.5 text-[color:var(--sub)] transition hover:bg-[color:var(--mist)] hover:text-[color:var(--ink)]"
          >
            <X size={15} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

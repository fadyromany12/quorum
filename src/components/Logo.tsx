/* The Konecta One mark — four arcs closing a single ring, around one filled
   centre.

   The arcs are the four phases the whole product is organised around: joining,
   working, growing, leaving. They are drawn as separate strokes because they
   are separate stages of employment, and they close one continuous circle
   because the point of the product is that they describe one person on one
   record. The dot at the middle is that record.

   It replaces the ring of eight seats, which meant "enough present to proceed"
   and made a Q out of its own tail. Good mark, wrong name — with no Q to form,
   the tail was decoration, and eight seats said something about coverage rather
   than about the journey the app is now built around.

   Pure SVG, no assets. Used by the login screen, the workspace header and
   the agent portal; app/icon.svg mirrors it for the favicon. */

import { BRAND } from "@/lib/brand";

/* Each arc spans 76° with a 14° gap after it, four times around a circle of
   radius 10 centred at (16,16). The endpoints are precomputed rather than
   derived at render: they never change, and running trigonometry on every
   header paint to arrive at four constants is work nobody asked for. */
const ARCS = [
  "M 16 6 A 10 10 0 0 1 25.703 13.581", // joining — from the top, clockwise
  "M 26 16 A 10 10 0 0 1 18.419 25.703", // working
  "M 16 26 A 10 10 0 0 1 6.297 18.419", // growing
  "M 6 16 A 10 10 0 0 1 13.581 6.297", // leaving — closing back to the top
];

export function OneMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="one-arc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--deep-accent)" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>
      </defs>
      {ARCS.map((d, i) => (
        <path key={i} d={d} stroke="url(#one-arc)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      ))}
      {/* The record at the centre — one, whatever phase is running around it. */}
      <circle cx="16" cy="16" r="3.2" fill={BRAND.signal} />
    </svg>
  );
}

export default function Logo({
  size = 30,
  subtitle,
  glow = true,
}: {
  size?: number;
  subtitle?: string;
  glow?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="grid shrink-0 place-items-center"
        style={glow ? { filter: `drop-shadow(0 0 10px ${BRAND.signalSoft})` } : undefined}
      >
        <OneMark size={size} />
      </span>
      <span className="min-w-0">
        <span
          className="block font-medium lowercase leading-none"
          style={{ fontFamily: "var(--font-display)", fontSize: size * 0.62, letterSpacing: "-0.02em", color: "var(--hdr-strong)" }}
        >
          {BRAND.wordmark}
        </span>
        {subtitle && (
          <span className="mt-1 block text-[11px] leading-none" style={{ color: "var(--sub)" }}>{subtitle}</span>
        )}
      </span>
    </div>
  );
}

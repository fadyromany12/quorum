/* The Quorum mark — a ring of eight seats, six present (filled, violet
   gradient), two absent (hollow), with the ring's tail kicking out to form
   the Q. The icon is the product: enough present to proceed.

   Pure SVG, no assets. Used by the login screen, the workspace header and
   the agent portal; app/icon.svg mirrors it for the favicon. */

import { BRAND } from "@/lib/brand";

const NODES = [
  { x: 16, y: 6, present: true },
  { x: 23.07, y: 8.93, present: false }, // the two absent seats sit NE/E —
  { x: 26, y: 16, present: false }, //      the gap the quorum still survives
  { x: 23.07, y: 23.07, present: true },
  { x: 16, y: 26, present: true },
  { x: 8.93, y: 23.07, present: true },
  { x: 6, y: 16, present: true },
  { x: 8.93, y: 8.93, present: true },
];

export function QuorumMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="q-node" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--deep-accent)" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>
      </defs>
      {/* hairline ring */}
      <circle cx="16" cy="16" r="10" stroke="var(--logo-ring)" strokeWidth="1" />
      {/* the Q's tail — through the SE seat, outward */}
      <line x1="23.07" y1="23.07" x2="29.5" y2="29.5" stroke={BRAND.signal} strokeWidth="2.4" strokeLinecap="round" />
      {NODES.map((n, i) =>
        n.present ? (
          <circle key={i} cx={n.x} cy={n.y} r="2.15" fill="url(#q-node)" />
        ) : (
          <circle key={i} cx={n.x} cy={n.y} r="1.65" stroke="var(--logo-seat)" strokeWidth="1.1" fill="none" />
        )
      )}
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
        <QuorumMark size={size} />
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

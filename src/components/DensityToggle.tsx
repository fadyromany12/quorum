"use client";

/* Switches the tables between comfortable and compact.

   Writes the cookie so the server renders the right spacing on the next
   request, and flips the attribute on <html> immediately so the change happens
   under the cursor rather than after a round-trip — the same shape as
   ThemeToggle, because it is the same kind of preference.

   No view transition here, unlike the theme. A cross-fade suits a colour change
   and actively hurts a spacing one: the whole point is to see rows move, and
   half a second of dissolve makes it hard to tell whether anything did. */

import { useState } from "react";
import { Rows3, Rows4 } from "lucide-react";
import { DEFAULT_DENSITY, DENSITY_LABEL, isDensity, nextDensity } from "@/lib/density.js";

const ICON: Record<string, typeof Rows3> = { comfortable: Rows3, compact: Rows4 };

export default function DensityToggle({ initial = DEFAULT_DENSITY }: { initial?: string }) {
  const [density, setDensity] = useState(isDensity(initial) ? initial : DEFAULT_DENSITY);

  const toggle = () => {
    const next = nextDensity(density);
    setDensity(next);
    document.cookie = `density=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.setAttribute("data-density", next);
  };

  const Icon = ICON[density] ?? Rows3;
  const label = DENSITY_LABEL[density as keyof typeof DENSITY_LABEL];

  return (
    <button
      type="button"
      onClick={toggle}
      title={`Row spacing: ${label} — click to change`}
      aria-label={`Row spacing: ${label}. Click to change.`}
      className="ao-glow inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition"
      style={{
        borderColor: "var(--line)",
        background: "var(--card)",
        color: "var(--ink-soft)",
      }}
    >
      <Icon size={13} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

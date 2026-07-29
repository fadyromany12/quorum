"use client";

/* Cycles dark → light → system. Writes the intent to a cookie (so the server
   can render the right theme on the next request) and flips data-theme on
   <html> immediately, so the change is instant rather than waiting on a
   round-trip. Follows the OS live while the intent is "system". */

import { useEffect, useState } from "react";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";
import { DEFAULT_THEME, THEMES, isTheme, resolveTheme } from "@/lib/theme.js";

const ICON = { dark: Moon, light: Sun, system: MonitorSmartphone };
const NEXT = { dark: "light", light: "system", system: "dark" } as const;
const LABEL = { dark: "Dark", light: "Light", system: "System" };

const prefersDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

const paint = (intent: string) =>
  document.documentElement.setAttribute("data-theme", resolveTheme(intent, prefersDark()));

export default function ThemeToggle({ initial = DEFAULT_THEME }: { initial?: string }) {
  const [intent, setIntent] = useState(isTheme(initial) ? initial : DEFAULT_THEME);

  // While following the OS, track it live.
  useEffect(() => {
    if (intent !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => paint("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [intent]);

  const cycle = () => {
    const next = NEXT[intent as keyof typeof NEXT] ?? "dark";
    const apply = () => {
      setIntent(next);
      document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
      paint(next);
    };
    // Cross-fade the whole page between themes where the browser supports it.
    const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (d.startViewTransition) d.startViewTransition(apply);
    else apply();
  };

  const Icon = ICON[intent as keyof typeof ICON] ?? Moon;

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${LABEL[intent as keyof typeof LABEL]} — click to change`}
      aria-label={`Theme: ${LABEL[intent as keyof typeof LABEL]}. Click to change.`}
      className="ao-glow inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition"
      style={{
        borderColor: "var(--line)",
        background: "var(--card)",
        color: "var(--ink-soft)",
      }}
    >
      <Icon size={13} className="transition-transform duration-300" />
      <span className="hidden sm:inline">{LABEL[intent as keyof typeof LABEL]}</span>
    </button>
  );
}

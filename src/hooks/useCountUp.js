"use client";

/* Animates a number toward its target with an ease-out curve.

   Used by the KPI scorecard so figures resolve rather than snap — the count
   also re-runs whenever the underlying value changes, which makes a case being
   escalated or voided visible at a glance. Honours prefers-reduced-motion by
   jumping straight to the target. */

import { useEffect, useRef, useState } from "react";

const REDUCED = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function useCountUp(target, duration = 620) {
  const to = Number(target) || 0;
  const [n, setN] = useState(to);
  const fromRef = useRef(to);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === to) return;

    if (REDUCED() || duration <= 0) {
      fromRef.current = to;
      setN(to);
      return;
    }

    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      // easeOutCubic — fast out of the gate, settles gently on the value.
      const eased = 1 - Math.pow(1 - p, 3);
      const value = from + (to - from) * eased;
      setN(p === 1 ? to : value);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [to, duration]);

  return n;
}

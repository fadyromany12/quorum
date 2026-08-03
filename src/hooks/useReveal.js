"use client";

/* Reveal on approach.

   Entrance animations used to run at mount, which means everything below the
   fold finished animating before anyone scrolled to it — the effect is spent on
   nobody, and the rest of the page then arrives dead. This defers the entrance
   until the element is near the viewport.

   Two details that matter more than the observer itself:

   · It reveals once and then stops observing. Content that re-animates every
     time it scrolls back into view is a novelty on the first pass and an
     irritation by the third, and on a long directory it never settles.

   · Without IntersectionObserver — or before hydration — elements must end up
     visible, not hidden. A progressive enhancement that hides content when it
     fails is not an enhancement. */

import { useEffect, useRef } from "react";

/**
 * Watch a container and mark its `.ao-reveal` descendants as they approach.
 *
 * A container rather than one ref per item, because the items are usually a
 * mapped list and a ref each means a hook per row.
 *
 * @param {unknown} deps changes that replace the children (a filter, a page)
 * @returns {import("react").RefObject<HTMLElement|null>}
 */
export function useReveal(deps = null) {
  const ref = useRef(/** @type {HTMLElement|null} */ (null));

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const targets = root.querySelectorAll(".ao-reveal:not(.is-in)");
    if (!targets.length) return;

    /* No observer, or a browser that would leave them hidden: show everything
       immediately. Visible-but-unanimated is the correct degradation. */
    if (typeof IntersectionObserver === "undefined") {
      for (const el of targets) el.classList.add("is-in");
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          io.unobserve(e.target); // once is enough
        }
      },
      /* Start slightly before the element arrives, so it is already settled by
         the time it is properly in view rather than animating under the reader's
         eye. */
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );

    for (const [i, el] of [...targets].entries()) {
      // The stagger index, so a row knows its place without the CSS counting.
      el.style.setProperty("--i", String(i));
      io.observe(el);
    }
    return () => io.disconnect();
  }, [deps]);

  return ref;
}

"use client";

/* A hover explanation for a control that shows only an icon.

   An icon is a guess until someone has been told what it means. The browser's
   own `title` attribute technically says so, but it waits a second and a half,
   renders in the OS font outside the page's design, and never appears for
   keyboard users at all — so in practice nobody reads it and the icon stays a
   guess.

   Two decisions worth stating:

     1. The bubble is `aria-hidden`. Screen readers already have the control's
        `aria-label`, and announcing both would read the same thing twice. That
        makes an accessible name on the child *mandatory*, not optional — this
        wrapper is a visual aid, and it does not make an unlabelled button
        accessible. Nothing here can enforce that, so it is said loudly instead.

     2. Show and hide are CSS, driven by `:hover` and `:focus-within` on the
        wrapper. No state, no timers, no re-render on mouse move — and the
        keyboard case comes free rather than being the thing everyone forgets. */

export default function Tip({ label, side = "top", children, className = "", fill = false }) {
  if (!label) return children;
  return (
    /* `fill` is for wrapping something that is itself a layout box — a grid
       tile, a full-width row. Without it the wrapper is inline-flex, which is
       right for a button and wrong for a card. */
    <span className={`ao-tip ${className}`} data-side={side} data-fill={fill ? "true" : undefined}>
      {children}
      <span className="ao-tip-bubble ao-disp" role="presentation" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}

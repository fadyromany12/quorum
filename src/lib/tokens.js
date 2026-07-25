/* Design tokens — Quorum's "Ink & Signal" palette.

   Every value here resolves to a CSS custom property defined in
   app/globals.css, so the ~376 inline style reads across the workspace
   re-theme themselves the instant [data-theme] changes on <html>. Nothing in
   this file is a literal colour: that is what makes light mode possible
   without touching a single component.

   Colour discipline (enforced in globals.css, restated here because this is
   where components look):
     · WARM ramp (amber → coral → pink) = SEVERITY only.
     · COOL family = account identity, never a judgement.
     · Violet Signal = brand / primary action / pending review.
   Identity colours are less saturated than semantic ones, so the most vivid
   thing on screen is always the most important. */

export const P = {
  // Surfaces
  paper: "var(--paper)", // the aurora shows through
  card: "var(--card)", // frosted panel fill (pair with .ao-glass for blur)
  deep: "var(--deep)", // headers & verdict panels — heavier than the cards
  mist: "var(--mist)", // inset wells, chart tracks, chips
  line: "var(--line)", // hairline borders

  // Text
  ink: "var(--ink)", // primary
  inkSoft: "var(--ink-soft)", // secondary
  sub: "var(--sub)", // muted / labels

  // The Signal — Quorum violet. Primary actions, active nav, pending states.
  petrol: "var(--signal)", // (name kept for compatibility: ~40 call sites read P.petrol)

  // Semantic accents
  amber: "var(--amber)",
  brick: "var(--brick)",
  green: "var(--green)",

  // Tinted callout backgrounds
  amberWash: "var(--amber-wash)",
  brickWash: "var(--brick-wash)",
  greenWash: "var(--green-wash)",
  signalWash: "var(--signal-wash)",
};

/**
 * Translucent variant of any token.
 *
 * Components used to build these by concatenating hex alpha (`${P.amber}55`),
 * which cannot work once a token is `var(--amber)`. color-mix() does the same
 * job against a custom property and stays theme-aware.
 */
export const alpha = (color, a) =>
  `color-mix(in srgb, ${color} ${Math.round(Math.max(0, Math.min(1, a)) * 100)}%, transparent)`;

export const SEV_ORDER = ["Minor", "Moderate", "Serious", "Zero Tolerance"];

export const SEV_COLOR = {
  Minor: "var(--sev-minor)",
  Moderate: "var(--sev-moderate)",
  Serious: "var(--sev-serious)",
  // Magenta, not violet: Zero Tolerance must never read as brand accent.
  "Zero Tolerance": "var(--sev-zero)",
};

/* Accounts are identity, not judgement — a cool family separated by hue and
   lightness so no account chip can be mistaken for a severity chip. */
export const ACCOUNT_COLORS = {
  Hertz: "var(--acc-1)",
  Lenovo: "var(--acc-2)",
  Beko: "var(--acc-3)",
};

export const STATUS_COLOR = {
  "Pending review": P.petrol,
  Dismissed: P.sub,
  Voided: P.sub,
  Open: P.sub,
  "Awaiting OPS": P.amber,
  "Awaiting HR": P.brick,
  Closed: P.green,
};

export const accColor = (a) => ACCOUNT_COLORS[a] || P.petrol;
export const sevColor = (s) => SEV_COLOR[s] || P.brick;

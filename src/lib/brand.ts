/* The brand, in one place. Every header, title, login screen and doc string
   reads from here — renaming the product is an edit to this file, not a hunt. */

export const BRAND = {
  name: "Quorum",
  /** Lowercase wordmark form, per the identity spec. */
  wordmark: "quorum",
  /* The tagline names what the product is for. It used to say "workforce
     compliance", which described the first version honestly and the current one
     not at all — compliance is now one phase of four. */
  tagline: "The employee journey, on one record",
  /** Longer form, for the login screen and metadata. */
  promise: "From offer to exit — joining, working, growing and leaving, all on one record",
  org: "Konecta GDC",
  /** The Signal: the one accent color. Violet, per the Quorum identity. */
  signal: "#8B5CF6",
  signalSoft: "rgba(139,92,246,0.14)",
} as const;

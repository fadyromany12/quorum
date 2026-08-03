/* The brand, in one place. Every header, title, login screen and doc string
   reads from here — renaming the product is an edit to this file, not a hunt. */

export const BRAND = {
  name: "Konecta One",
  /** Lowercase wordmark form, per the identity spec. */
  wordmark: "konecta one",
  /** Filename- and URL-safe form, for exports. Derived here rather than at each
      call site so a rename cannot leave last year's name on a download. */
  slug: "konecta-one",
  /* The tagline names what the product is for. It used to say "workforce
     compliance", which described the first version honestly and the current one
     not at all — compliance is now one phase of four. The current name says the
     rest of it: One, because the point is a single record rather than a payroll
     sheet, a clock export and someone's spreadsheet of warnings. */
  tagline: "The employee journey, on one record",
  /** Longer form, for the login screen and metadata. */
  promise: "From offer to exit — joining, working, growing and leaving, all on one record",
  org: "Konecta GDC",
  /* The Signal: the one accent colour, kept through the rename. It is the only
     accent in the palette, which is what makes it mean something — anything
     violet is somewhere to act. Repainting it at the same time as renaming
     would also make any legibility regression impossible to attribute, and the
     backdrop blur only started rendering correctly in this same batch. */
  signal: "#8B5CF6",
  signalSoft: "rgba(139,92,246,0.14)",
} as const;

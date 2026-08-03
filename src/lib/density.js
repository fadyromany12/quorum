/* How tightly the tables pack.

   This exists because of who uses the product. A team lead scanning the roster,
   an HR partner working the directory and anyone reading the audit trail spend
   their day in lists, and the comfortable spacing that makes a form pleasant
   costs them rows. Fewer rows per screen is more scrolling, and more scrolling
   is how you miss the person you were looking for.

   It is a preference rather than a setting anyone has to understand, so it
   follows the same shape as the theme: one cookie, read by the server, applied
   as an attribute on the shell before first paint. Nothing here decides what
   the spacing *is* — globals.css does, keyed off [data-density] — so tuning the
   scale never touches JavaScript.

   Deliberately only two values. A slider would invite a dozen intermediate
   states nobody can name and every one of them a layout to check. */

export const DENSITIES = ["comfortable", "compact"];
export const DEFAULT_DENSITY = "comfortable";
export const DENSITY_COOKIE = "density";

export const isDensity = (d) => DENSITIES.includes(d);

/** What the toggle switches to from here. */
export const nextDensity = (d) => (d === "compact" ? "comfortable" : "compact");

export const DENSITY_LABEL = {
  comfortable: "Comfortable",
  compact: "Compact",
};

export const DENSITY_LABEL_AR = {
  comfortable: "مريح",
  compact: "مضغوط",
};

/* Applied before first paint, for the same reason the theme is: the server
   already rendered with this value, and letting the client discover it a frame
   later would reflow every table on every load. */
export const DENSITY_SCRIPT = `
(function(){try{
  var m=document.cookie.match(/(?:^|; )density=([^;]*)/);
  var d=m?decodeURIComponent(m[1]):'${DEFAULT_DENSITY}';
  document.documentElement.setAttribute('data-density', d==='compact'?'compact':'comfortable');
}catch(e){}})();
`.trim();

/* Theme selection: dark, light, or follow the OS.

   "system" is stored as an intent, not a value — it resolves at paint time so
   a user who flips their OS appearance sees Quorum follow without touching a
   setting. globals.css does the actual work; all this decides is which
   data-theme lands on <html>. */

export const THEMES = ["dark", "light", "system"];
export const DEFAULT_THEME = "system";
export const THEME_COOKIE = "theme";

export const isTheme = (t) => THEMES.includes(t);

/** The concrete theme to paint, given the stored intent and the OS preference. */
export const resolveTheme = (intent, prefersDark = true) =>
  intent === "light" || intent === "dark" ? intent : prefersDark ? "dark" : "light";

/* Runs before first paint (inlined into <head>) so the correct theme is on
   <html> from the very first frame — no white flash on a dark-mode reload.
   Kept dependency-free and tiny; it re-reads the cookie the server already
   used, then upgrades "system" to the live OS value. */
export const NO_FLASH_SCRIPT = `
(function(){try{
  var m=document.cookie.match(/(?:^|; )theme=([^;]*)/);
  var intent=m?decodeURIComponent(m[1]):'${DEFAULT_THEME}';
  var dark=intent==='dark'||(intent!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme',dark?'dark':'light');
}catch(e){}})();
`.trim();

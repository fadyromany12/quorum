/* Projecting record text into what a standard PDF font can draw.

   The built-in Helvetica that pdf-lib embeds is WinAnsi (CP1252) and *throws*
   on any character outside it. That turns a name into an outage: an employee
   called "Zoë" or a note carrying a № would take down the letter endpoint
   rather than print imperfectly.

   Two decisions matter here, and both go against the reflex:

     1. Do not strip to ASCII. CP1252 already carries the typographic set —
        em dashes, curly quotes, the ellipsis, the bullet — so "Konecta GDC —
        Human Resources" prints as written. Stripping it would leave a hole in
        the middle of the sentence, which is worse than the character.

     2. Substitute visibly, do not delete. What genuinely has no CP1252 form
        (Arabic, CJK) becomes "?" rather than vanishing. A letter with a
        visible gap gets queried and reissued; a letter that silently drops a
        character reads as correct and is wrong. These are documents people
        take to a bank.

   Arabic legal names live in the record, not in these letters — the latin name
   is what a bank or an embassy can read anyway. */

/** The CP1252 characters above Latin-1 that Helvetica can still draw. */
export const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/* Characters with no CP1252 point that have an obvious, lossless ASCII reading.
   Without these they become "?", and a "?" in front of a money column on a
   payslip reads as a corrupted document — which, to the person holding it, is
   exactly what it is. U+2212 is the typographic minus the UI uses; the hyphen
   is what a PDF can render. */
const EXPAND = [
  [/№/g, "No."],
  [/\u2212/g, "-"],   // minus sign → hyphen-minus
  [/[\u2010\u2011]/g, "-"], // hyphen, non-breaking hyphen
  [/\u2044/g, "/"],   // fraction slash
];

/**
 * Project a string into the WinAnsi range, losslessly where CP1252 allows.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function winAnsi(s) {
  let out = String(s ?? "");
  for (const [re, to] of EXPAND) out = out.replace(re, to);
  return out
    .split("")
    .map((ch) => ((ch.codePointAt(0) ?? 0) <= 0xff || CP1252_EXTRA.includes(ch) ? ch : "?"))
    .join("");
}

/** As {@link winAnsi}, with the surrounding whitespace trimmed — for headings
    and single-line fields, where a stray space shifts the layout. */
export const winAnsiLine = (s) => winAnsi(s).replace(/\s+/g, " ").trim();

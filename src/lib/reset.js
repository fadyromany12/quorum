/* Password reset — the parts that are the same whichever way a code reaches
   someone. Pure, no I/O.

   ── The rule everything here follows ───────────────────────────────────────
   A password is never sent to anyone, by any channel, ever. Not to the
   employee, not to IT, not into a ticket. What travels is a single-use code
   that only proves "the person holding this asked for a reset"; the password
   itself is chosen by the employee at redemption and is never known to anyone
   else. That rules out the design people usually ask for — "IT resets it and
   emails them the new one" — for three reasons worth writing down, because
   somebody will ask for it again:

     · A password in an inbox is a password in every backup of that inbox, on
       every device it syncs to, and readable by anyone who later gains access
       to the account.
     · A password IT knows is a password an employee can plausibly deny using,
       which quietly destroys the accountability of every action taken under
       that login.
     · It trains people that a message containing a password is legitimate,
       which is the exact reflex phishing depends on.

   ── Enumeration ────────────────────────────────────────────────────────────
   A reset request answers identically whether or not the address exists. An
   endpoint that says "no such account" is a free tool for checking which of a
   leaked address list works here. The response is deliberately the same
   sentence and the same shape either way.

   ── Codes ──────────────────────────────────────────────────────────────────
   Codes are stored as hashes, never in the clear, so a database read does not
   hand over live resets. They are short-lived, single-use, and invalidated by a
   successful sign-in — if someone signs in normally after requesting a reset,
   the request was either abandoned or was not theirs, and either way the code
   should stop working. */

/** How long a code is good for. Long enough to walk to a desk and read a
    screen, short enough that a code left in a chat log expires before it is
    useful. */
export const CODE_TTL_MINUTES = 20;

/** How many codes one account may request in an hour. Not a security boundary
    on its own — it is there so a mistyped address cannot be used to flood
    someone's inbox, and so a script cannot burn through the code space. */
export const MAX_REQUESTS_PER_HOUR = 5;

/** How many wrong codes may be tried before the request is dead. Deliberately
    small: an eight-character code has plenty of entropy (see CODE_ALPHABET),
    so anything past a few attempts is not a typo. */
export const MAX_ATTEMPTS = 5;

/* Crockford's alphabet minus every glyph that can be misheard or misread.
   Someone is going to read this down a phone line in a noisy contact centre, so
   out go I, L and 1 (indistinguishable spoken and nearly so printed), O and 0,
   and U — which turns up in unfortunate accidents.

   Thirty symbols over eight characters is 39 bits, which is ample for a code
   that dies in twenty minutes after five wrong guesses. Legibility is worth
   more here than the two bits that keeping L and I would buy. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 8;

/**
 * A human-readable single-use code.
 *
 * @param {(n: number) => Uint8Array} randomBytes injected so this stays pure
 *        and testable; the caller passes node:crypto's.
 */
export function makeCode(randomBytes) {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  // Grouped for reading aloud: XXXX-XXXX.
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Normalise a code the way a person will type it: any case, any spacing,
    hyphen optional. Nobody should fail a reset because they typed a space. */
export const normaliseCode = (s) =>
  String(s ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/** Whether a string could be a code at all — checked before any lookup, so a
    malformed submission costs no database round trip and no attempt. */
export const looksLikeCode = (s) => normaliseCode(s).length === CODE_LENGTH;

/**
 * Whether a reset request can still be redeemed, and why not when it cannot.
 *
 * Returns a reason for the log, and a separate `publicMessage` for the person —
 * these differ on purpose. The log needs to distinguish "expired" from "already
 * used" from "too many attempts"; the person gets one sentence for all three,
 * because telling them which one it was tells an attacker the same thing.
 *
 * @param {{createdAt: string|Date, usedAt?: string|Date|null, attempts?: number, revokedAt?: string|Date|null}} req
 * @param {Date} [now]
 */
export function redeemable(req, now = new Date()) {
  const deny = (reason) => ({
    ok: false,
    reason,
    publicMessage: "That code is not valid. Ask for a new one.",
  });
  if (!req) return deny("no such request");
  if (req.usedAt) return deny("already used");
  if (req.revokedAt) return deny("revoked");
  if ((req.attempts ?? 0) >= MAX_ATTEMPTS) return deny("too many attempts");

  const created = new Date(req.createdAt).getTime();
  if (!Number.isFinite(created)) return deny("unparseable creation time");
  const ageMinutes = (now.getTime() - created) / 60000;
  if (ageMinutes < 0) return deny("created in the future");
  if (ageMinutes > CODE_TTL_MINUTES) return deny("expired");

  return { ok: true, reason: "", publicMessage: "", minutesLeft: Math.max(0, Math.ceil(CODE_TTL_MINUTES - ageMinutes)) };
}

/**
 * Whether another code may be issued for this account right now.
 *
 * @param {Array<{createdAt: string|Date}>} recent requests in the last hour
 */
export function mayRequest(recent, now = new Date()) {
  const hourAgo = now.getTime() - 3600_000;
  const inWindow = (recent ?? []).filter((r) => new Date(r.createdAt).getTime() >= hourAgo);
  if (inWindow.length >= MAX_REQUESTS_PER_HOUR) {
    return {
      ok: false,
      reason: `${inWindow.length} requests in the last hour`,
      /* Same sentence the success path gives. A rate limit that announces
         itself tells an attacker they found a real account. */
      publicMessage: RESET_ACK,
    };
  }
  return { ok: true, reason: "", publicMessage: RESET_ACK };
}

/** The one sentence every reset request gets, whether or not the address
    exists, whether or not it was rate limited. */
export const RESET_ACK =
  "If that address belongs to an account, a reset code is on its way. It is valid for 20 minutes.";

/**
 * What the person should be told to do next, given how the code reaches them.
 *
 * Both channels exist because both situations are real: an agent with a working
 * company mailbox can self-serve, and an agent whose only company account is
 * the one they are locked out of cannot. The difference is *delivery* — the
 * code, its lifetime, its single use and the fact that nobody ever learns the
 * password are identical either way.
 */
export const DELIVERY = {
  email: {
    id: "email",
    label: "Emailed to the employee",
    instruction: "Check your work email for an 8-character code, then enter it below with your new password.",
    /* Nothing to do for IT: the person completes it alone. */
    itAction: "",
  },
  itIssued: {
    id: "itIssued",
    label: "Read out by IT",
    instruction: "Contact IT with your employee ID. They will read you an 8-character code, which you enter below with your new password.",
    itAction: "Read the code to the employee after confirming who they are. Do not send it in a message, and never ask for or set their password.",
  },
};

/** Which delivery to use, from configuration rather than from a guess. */
export const deliveryFor = (mode) => DELIVERY[mode] ?? DELIVERY.itIssued;

/**
 * Everything wrong with a redemption attempt before any lookup happens.
 * @returns {string[]} empty when the shape is acceptable
 */
export function checkRedemption({ code, password }, passwordProblem) {
  const problems = [];
  if (!looksLikeCode(code)) problems.push("That code is not the right length — it is 8 characters, like ABCD-2345.");
  const pw = passwordProblem ? passwordProblem(password) : null;
  if (pw) problems.push(pw);
  return problems;
}

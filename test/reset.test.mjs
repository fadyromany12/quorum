/* Password reset.

   The properties worth guaranteeing here are all refusals, and most of them are
   about what the system declines to reveal rather than what it does:

     · a reset request answers identically for a real and a fake address, and
       identically again when rate limited — otherwise the endpoint is a free
       tool for testing a leaked address list against this company
     · a failed redemption gives one sentence for expired, used, revoked and
       exhausted alike, because distinguishing them tells an attacker the same
       thing it tells the user
     · a code a person has to read aloud in a noisy room contains no character
       that can be confused for another

   Nothing here tests that a password is emailed, because nothing ever emails
   one. That is the design, and the test that would catch a regression is the
   absence of any function that could. */

const R = await import("../src/lib/reset.js");
const { passwordProblem } = await import("../src/lib/auth.js");

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n         want: ${JSON.stringify(want)}`);

/* Deterministic "randomness" so code generation is testable. */
const seeded = (seed) => (n) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out[i] = x % 256; }
  return out;
};

console.log("\n── Codes are readable aloud ──");
{
  const code = R.makeCode(seeded(7));
  ok("it is grouped for reading", /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code), code);
  ok("nothing in it can be misheard or misread", !/[IL1O0U]/.test(code), code);
}
ok("no code from a thousand draws contains an ambiguous glyph", (() => {
  for (let s = 1; s <= 1000; s++) if (/[IL1O0U]/.test(R.makeCode(seeded(s)))) return false;
  return true;
})());
ok("codes differ between draws", R.makeCode(seeded(1)) !== R.makeCode(seeded(2)));

console.log("\n── Typing it back is forgiving ──");
eq("lower case is fine", R.normaliseCode("abcd-2345"), "ABCD2345");
eq("spaces are fine", R.normaliseCode(" ABCD 2345 "), "ABCD2345");
eq("the hyphen is optional", R.normaliseCode("ABCD2345"), "ABCD2345");
ok("a full-length code is recognised", R.looksLikeCode("abcd-2345"));
ok("a short one is not", !R.looksLikeCode("ABC-123"));
ok("nothing is not", !R.looksLikeCode("") && !R.looksLikeCode(null));

console.log("\n── A failed redemption says the same thing every time ──");
{
  const now = new Date("2026-08-03T12:00:00Z");
  const at = (mins) => new Date(now.getTime() - mins * 60000).toISOString();

  const cases = [
    ["expired", { createdAt: at(21) }],
    ["already used", { createdAt: at(1), usedAt: at(0) }],
    ["revoked", { createdAt: at(1), revokedAt: at(0) }],
    ["too many attempts", { createdAt: at(1), attempts: 5 }],
    ["no such request", null],
  ];
  const messages = new Set();
  for (const [why, req] of cases) {
    const v = R.redeemable(req, now);
    ok(`${why} is refused`, v.ok === false);
    ok(`${why} is distinguishable in the log`, v.reason.length > 0);
    messages.add(v.publicMessage);
  }
  ok("but the person is told one sentence for all five", messages.size === 1, [...messages].join(" | "));
  ok("and that sentence does not name the cause", ![...messages][0].match(/expired|used|revoked|attempts/i));
}

console.log("\n── A live code is redeemable, and says how long is left ──");
{
  const now = new Date("2026-08-03T12:00:00Z");
  const v = R.redeemable({ createdAt: new Date(now.getTime() - 5 * 60000).toISOString() }, now);
  ok("a five-minute-old code works", v.ok === true);
  ok("with fifteen minutes left", v.minutesLeft === 15, `got ${v.minutesLeft}`);
  ok("a code at the very edge still works", R.redeemable({ createdAt: new Date(now.getTime() - 19.9 * 60000).toISOString() }, now).ok === true);
  ok("a second past the edge does not", R.redeemable({ createdAt: new Date(now.getTime() - 20.1 * 60000).toISOString() }, now).ok === false);
  ok("a code created in the future is refused rather than trusted",
    R.redeemable({ createdAt: new Date(now.getTime() + 60000).toISOString() }, now).ok === false);
  ok("an unparseable timestamp is refused rather than treated as now",
    R.redeemable({ createdAt: "not a date" }, now).ok === false);
}

console.log("\n── Rate limiting does not announce itself ──");
{
  const now = new Date("2026-08-03T12:00:00Z");
  const recent = (n, minsAgo) => Array.from({ length: n }, () => ({ createdAt: new Date(now.getTime() - minsAgo * 60000).toISOString() }));

  const fine = R.mayRequest(recent(2, 10), now);
  const limited = R.mayRequest(recent(5, 10), now);
  ok("two requests in an hour is fine", fine.ok === true);
  ok("five is not", limited.ok === false);
  ok("but both say exactly the same thing to the person", fine.publicMessage === limited.publicMessage);
  ok("which is the same thing an unknown address gets", fine.publicMessage === R.RESET_ACK);
  ok("the reason is still available for the log", limited.reason.includes("5 requests"));
  ok("requests older than an hour do not count", R.mayRequest(recent(9, 61), now).ok === true);
  ok("no history at all is fine", R.mayRequest([], now).ok === true && R.mayRequest(null, now).ok === true);
}

console.log("\n── The acknowledgement reveals nothing ──");
ok("it is conditional, never confirming", /^If that address/.test(R.RESET_ACK));
ok("it does not say whether an account was found", !/no account|not found|exists/i.test(R.RESET_ACK));
ok("and it states the lifetime, so nobody waits for a code that has died", /20 minutes/.test(R.RESET_ACK));

console.log("\n── Delivery differs; the guarantees do not ──");
ok("both channels exist", !!R.DELIVERY.email && !!R.DELIVERY.itIssued);
ok("an unknown mode falls back to the one that needs no mailbox", R.deliveryFor("nonsense").id === "itIssued");
ok("email self-serves, with nothing for IT to do", R.DELIVERY.email.itAction === "");
ok("IT is told to confirm identity first", /confirming who they are/i.test(R.DELIVERY.itIssued.itAction));
ok("and told never to learn the password", /never ask for or set their password/i.test(R.DELIVERY.itIssued.itAction));
ok("neither instruction mentions sending a password", (() => {
  const text = Object.values(R.DELIVERY).map((d) => `${d.instruction} ${d.itAction}`).join(" ");
  return !/send (them )?(a |the )?(new )?password|password (will be|is) (sent|emailed)/i.test(text);
})());

console.log("\n── A redemption is shape-checked before anything is looked up ──");
eq("a good submission has no problems",
  R.checkRedemption({ code: "ABCD-2345", password: "Str0ngPass" }, passwordProblem), []);
ok("a short code is caught", R.checkRedemption({ code: "ABC", password: "Str0ngPass" }, passwordProblem).some((p) => /8 characters/.test(p)));
ok("a weak password is caught by the same policy the rest of the app uses",
  R.checkRedemption({ code: "ABCD-2345", password: "short" }, passwordProblem).length > 0);
ok("both are reported together, so nobody fixes one and resubmits to find the other",
  R.checkRedemption({ code: "ABC", password: "short" }, passwordProblem).length === 2);
ok("the default password cannot be set through a reset",
  R.checkRedemption({ code: "ABCD-2345", password: "Welcome@123" }, passwordProblem).length > 0);

console.log("\n── The limits are the ones the design assumes ──");
ok("codes live 20 minutes", R.CODE_TTL_MINUTES === 20);
ok("five attempts, then dead", R.MAX_ATTEMPTS === 5);
ok("five requests an hour", R.MAX_REQUESTS_PER_HOUR === 5);
/* Asserted from the alphabet itself rather than a remembered size, so shrinking
   it for legibility cannot silently drop the entropy below what a 20-minute,
   five-attempt code needs. */
ok("the alphabet contains nothing that can be misheard", !/[IL1O0U]/.test(R.CODE_ALPHABET));
ok("and it is still ample entropy",
  Math.log2(R.CODE_ALPHABET.length ** R.CODE_LENGTH) > 38,
  `${R.CODE_ALPHABET.length} symbols, ${R.CODE_LENGTH} long = ${Math.log2(R.CODE_ALPHABET.length ** R.CODE_LENGTH).toFixed(1)} bits`);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

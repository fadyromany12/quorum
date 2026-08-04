/* Break-glass account recovery — the way back in when nobody can sign in.
 *
 *   node scripts/break-glass.mjs unlock <email>
 *   node scripts/break-glass.mjs reset  <email> [--password '...']
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The deployment locked its only Super Admin out, and there was no route back.
 * Self-serve recovery issues a one-time code, delivery is `itIssued`, and email
 * is off — so the code was generated and went nowhere. Every in-app path to a
 * password runs through an account somebody has to already be signed in to.
 *
 * A system whose recovery story is "ask the administrator" needs an answer for
 * when the administrator is the one locked out. This is that answer.
 *
 * ── Why this is not a back door ────────────────────────────────────────────
 *
 * It requires DATABASE_URL. Anyone holding that can already read every table,
 * write any row and set any hash with psql — this grants no authority they did
 * not have, it just makes the safe version of it one command instead of a
 * hand-written UPDATE against a bcrypt hash somebody pasted from a gist.
 *
 * What it deliberately does NOT do: print, log or accept an existing password.
 * A reset sets a new one and forces a change at next sign-in, so the operator
 * running this never learns the password the user ends up with.
 *
 * ── The two commands are different sizes on purpose ────────────────────────
 *
 * `unlock` is almost always the right one and changes no credential — it clears
 * the throttle counter, which is what "I know my password and it says it is
 * wrong" actually means five times out of six. Reaching for `reset` first is
 * how a recoverable lockout becomes a changed password nobody needed.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const [, , command, emailArg, ...rest] = process.argv;
const email = String(emailArg ?? "").trim().toLowerCase();

const die = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};

if (!["unlock", "reset"].includes(command) || !email) {
  die(
    "Usage:\n" +
      "  node scripts/break-glass.mjs unlock <email>          clear the sign-in throttle\n" +
      "  node scripts/break-glass.mjs reset  <email>          set a new password, forced change at next login\n" +
      "  node scripts/break-glass.mjs reset  <email> --password '...'\n\n" +
      "Try `unlock` first. 'It says my password is wrong' is usually the throttle,\n" +
      "which blocks for 15 minutes and reports itself as a bad password.",
  );
}
if (!process.env.DATABASE_URL) die("DATABASE_URL is not set. Point it at the database you mean to touch.");

/* No I/O-free way to be sure which database this is, so say it out loud. A
   break-glass command run against the wrong environment is a bad afternoon. */
const target = process.env.DATABASE_URL.replace(/:\/\/([^:]+):[^@]*@/, "://$1:****@");
console.log(`\nDatabase: ${target}`);

/* Constructed the way src/lib/prisma.ts does. Prisma 7 uses driver adapters,
   so a bare `new PrismaClient()` is not a simpler version of the app's client —
   it is an invalid one, and it fails at construction with a message about
   options rather than about the adapter. */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 2 }),
});

/** Readable aloud over a phone: no I/L/1/O/0 to mishear or mistype. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnpqrstvwxyz";
function strongPassword(length = 16) {
  const bytes = randomBytes(length * 2);
  let out = "";
  for (let i = 0; out.length < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  // The policy needs a lower, an upper and a digit; the alphabet has all three
  // but a short random draw can miss one, so guarantee it rather than hope.
  return `${out.slice(0, length - 3)}aQ7`;
}

try {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user) die(`No account with the address ${email}.`);
  console.log(`Account:  ${user.name} · ${user.role}${user.active ? "" : " · INACTIVE"}`);

  /* Both commands clear the throttle. A reset that left the counter in place
     would hand someone a working password and go on telling them it is wrong,
     which is the exact confusion this whole script exists because of. */
  const cleared = await prisma.loginAttempt.deleteMany({ where: { email } });
  console.log(`\nCleared ${cleared.count} failed sign-in attempt(s) — the throttle is off for this address.`);

  if (command === "unlock") {
    console.log("\nDone. Sign in with the existing password.\n");
  } else {
    const flagIndex = rest.indexOf("--password");
    const supplied = flagIndex >= 0 ? rest[flagIndex + 1] : null;
    const password = supplied || strongPassword();
    if (supplied && supplied.length < 8) die("That password is shorter than the policy allows (8 characters).");

    await prisma.user.update({
      where: { id: user.id },
      data: { passHash: bcrypt.hashSync(password, 10), mustChange: true },
    });

    /* Any live recovery code is killed, for the same reason a normal sign-in
       kills one: after this the code is either unnecessary or was not theirs. */
    await prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "breakGlass" },
    });

    /* Audited, because an unaudited administrative password change is
       indistinguishable from a compromise after the fact. */
    await prisma.auditLog.create({
      data: {
        actorName: "break-glass",
        actorRole: "system",
        action: "PASSWORD_BREAK_GLASS",
        summary: `Password reset for ${user.email} from the command line. A change is forced at next sign-in.`,
        meta: { userId: user.id, email: user.email },
      },
    });

    console.log("\n  Temporary password:  " + password);
    console.log("\n  It must be changed at first sign-in, and it is not stored anywhere else —");
    console.log("  this is the only time it is shown. Any live recovery code has been revoked.\n");
  }
} catch (err) {
  die(`Failed: ${err?.message ?? err}`);
} finally {
  await prisma.$disconnect();
}

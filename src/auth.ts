/* NextAuth v5 — credentials provider over the Prisma user table, JWT sessions.
   The token carries id / role / empId / mustChange so layouts and API routes
   can authorize without a DB round-trip; sensitive checks still re-read the DB. */

import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/passwords";
import { loginStatus, recordLoginFailure, clearLoginFailures } from "@/lib/login-throttle";

// Authentication audit. Best-effort: a logging failure must never block a
// login, so every write is wrapped. actorId links to the user on success.
async function auditLogin(
  action: "LOGIN_SUCCEEDED" | "LOGIN_FAILED" | "LOGIN_BLOCKED",
  email: string,
  extra: { actorId?: string; role?: string; reason?: string } = {}
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: extra.actorId ?? null,
        actorName: email || "unknown",
        actorRole: extra.role ?? "Anonymous",
        action,
        summary:
          action === "LOGIN_SUCCEEDED"
            ? `Signed in: ${email}`
            : action === "LOGIN_BLOCKED"
              ? `Login blocked (rate limited): ${email}`
              : `Failed login: ${email}`,
        meta: extra.reason ? { reason: extra.reason } : {},
      },
    });
  } catch {
    /* audit is best-effort — never break auth on a logging error */
  }
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      empId: string | null;
      mustChange: boolean;
    } & DefaultSession["user"];
  }
  interface User {
    role?: string;
    empId?: string | null;
    mustChange?: boolean;
  }
}

/* Carries a `code` NextAuth passes to the client, so the sign-in form can say
   something true instead of something misleading. */
class ThrottledSignin extends CredentialsSignin {
  code = "throttled";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (creds) => {
        const email = String(creds?.email || "").trim().toLowerCase();
        const password = String(creds?.password || "");
        if (!email || !password) return null;

        /* Throttle first — a locked-out identifier costs no bcrypt work. The
           window lives in Postgres, so it holds across every serverless
           instance; a success clears the count.

           Thrown rather than returned as null, because null is what a wrong
           password returns and NextAuth renders both identically. A locked-out
           person then reads "invalid email or password", concludes their
           password is broken, and keeps trying — which is exactly how the only
           admin on this deployment lost an evening. The distinction is free of
           enumeration risk: recordLoginFailure() counts every failed attempt
           including ones for addresses that do not exist, so an attacker
           hammering a made-up address is told the same thing. */
        if ((await loginStatus(email)).blocked) {
          await auditLogin("LOGIN_BLOCKED", email, { reason: "rate_limited" });
          throw new ThrottledSignin();
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active || !verifyPassword(password, user.passHash)) {
          await recordLoginFailure(email);
          await auditLogin("LOGIN_FAILED", email, {
            reason: !user ? "no_such_user" : !user.active ? "inactive" : "bad_password",
          });
          return null;
        }
        await clearLoginFailures(email);
        /* A successful sign-in kills any live recovery code. If someone signs
           in normally after a code was issued, either they never needed it or
           it was not theirs — and in the second case the code must stop working
           without anybody having to notice and act. */
        await prisma.passwordReset.updateMany({
          where: { userId: user.id, usedAt: null, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: "signin" },
        });

        await auditLogin("LOGIN_SUCCEEDED", email, { actorId: user.id, role: user.role });
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          empId: user.empId,
          mustChange: user.mustChange,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
        token.empId = user.empId ?? null;
        token.mustChange = user.mustChange ?? false;
      }
      // Client calls update() after the forced password change so the session
      // reflects it without a re-login.
      if (trigger === "update" && session?.mustChange === false) token.mustChange = false;
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid as string;
      session.user.role = token.role as string;
      session.user.empId = (token.empId as string | null) ?? null;
      session.user.mustChange = Boolean(token.mustChange);
      return session;
    },
  },
});

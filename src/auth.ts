/* NextAuth v5 — credentials provider over the Prisma user table, JWT sessions.
   The token carries id / role / empId / mustChange so layouts and API routes
   can authorize without a DB round-trip; sensitive checks still re-read the DB. */

import NextAuth, { type DefaultSession } from "next-auth";
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

        // Throttle first — a locked-out identifier costs no bcrypt work. The
        // window lives in Postgres, so it holds across every serverless
        // instance; a success clears the count.
        if ((await loginStatus(email)).blocked) {
          await auditLogin("LOGIN_BLOCKED", email, { reason: "rate_limited" });
          return null;
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

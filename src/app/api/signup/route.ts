/* GET  /api/signup — is sign-up open on this deployment? (public)
   POST /api/signup — submit an application. (public, joining code required)

   The only unauthenticated write in the application. Everything about it is
   arranged around that: it is shut unless SIGNUP_CODE is set, it is rate
   limited by address, and what it creates cannot sign in. */

import { NextResponse } from "next/server";
import { guarded, GuardError } from "@/lib/api-guard";
import { signupGate, codeMatches } from "@/lib/signup.js";
import { createApplication } from "@/lib/signup-db";
import { loginStatus, recordLoginFailure } from "@/lib/login-throttle";
import { clientIp } from "@/lib/client-ip";

const gate = () => signupGate(process.env as Record<string, string | undefined>);

/* Whether the door is open, and nothing else. Not the code, not the domains,
   not the manager list — a closed deployment tells an anonymous caller only
   that it is closed. */
export const GET = guarded(async () => {
  const g = gate();
  return NextResponse.json({ open: g.open, ...(g.open ? {} : { reason: "Sign-up is not open on this deployment." }) });
});

export const POST = guarded(async (req: Request) => {
  const g = gate();
  if (!g.open) throw new GuardError(403, "Sign-up is not open on this deployment. Ask HR to add you directly.");

  const body = await req.json().catch(() => ({}));

  /* Throttled per caller, using the same Postgres window the sign-in throttle
     uses. Keyed on the address *and* the caller, because either one alone has a
     hole: a script guessing codes rotates the address it submits, and a shared
     key lets one attacker shut the form for everyone. */
  const email = String(body.email ?? "").trim().toLowerCase();
  const keys = [`signup:${clientIp(req)}`, `signup-email:${email || "anonymous"}`];
  for (const key of keys) {
    if ((await loginStatus(key)).blocked) {
      throw new GuardError(429, "Too many attempts. Wait about 15 minutes before trying again.");
    }
  }

  if (!codeMatches(body.code, g.code)) {
    await Promise.all(keys.map(recordLoginFailure));
    throw new GuardError(403, "That joining code is not right. It is in your offer pack — check it with HR.");
  }

  const result = await createApplication(body, { domains: g.domains });

  return NextResponse.json({
    ok: true,
    empId: result.empId,
    message:
      `Thank you, ${result.name}. Your application is with your manager. ` +
      `You will be able to sign in with the address and password you just chose once they approve it — ` +
      `until then the sign-in page will tell you it is still waiting.`,
  });
});

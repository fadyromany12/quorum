/* GET /api/signup/managers?code=… — the "who do you report to" menu. (public)

   An unauthenticated org chart, which is why it is behind the joining code and
   why it returns names and titles rather than addresses. The applicant cannot
   pick a manager without seeing one, and a menu is the only version of that
   question with a checkable answer — free text would put an unroutable string
   where the approval route has to go. */

import { NextResponse } from "next/server";
import { guarded, GuardError } from "@/lib/api-guard";
import { signupGate, codeMatches } from "@/lib/signup.js";
import { pickableManagers } from "@/lib/signup-db";
import { loginStatus, recordLoginFailure } from "@/lib/login-throttle";
import { clientIp } from "@/lib/client-ip";

export const GET = guarded(async (req: Request) => {
  const g = signupGate(process.env as Record<string, string | undefined>);
  if (!g.open) throw new GuardError(403, "Sign-up is not open on this deployment.");

  /* Keyed per caller rather than globally: five wrong codes from one address
     must not stop everybody else's application, which is a denial of service
     wearing a rate limiter's clothes. */
  const key = `signup-managers:${clientIp(req)}`;
  if ((await loginStatus(key)).blocked) {
    throw new GuardError(429, "Too many attempts. Wait about 15 minutes before trying again.");
  }

  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!codeMatches(code, g.code)) {
    await recordLoginFailure(key);
    throw new GuardError(403, "That joining code is not right.");
  }

  return NextResponse.json({ managers: await pickableManagers(), domains: g.domains });
});

/* TEMPORARY diagnostic — reports whether this deployment can reach its
   database and which host it is pointed at. Credentials are never returned:
   only the host, the database name, and the error text if a query fails.
   Remove once the deployment issue is resolved. */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const raw = process.env.DATABASE_URL || "";
  let host = "(DATABASE_URL not set)";
  let database = "";
  try {
    const u = new URL(raw);
    host = u.host;
    database = u.pathname.replace(/^\//, "");
  } catch {
    /* leave defaults */
  }

  const out: Record<string, unknown> = {
    host,
    database,
    hasAuthSecret: Boolean(process.env.AUTH_SECRET),
    vercelEnv: process.env.VERCEL_ENV ?? null,
  };

  try {
    const users = await prisma.user.count();
    const cases = await prisma.case.count();
    // Confirms the columns this build needs actually exist.
    const sample = await prisma.case.findFirst({ select: { id: true, voided: true, evidenceUrl: true, appealState: true } });
    out.db = "OK";
    out.users = users;
    out.cases = cases;
    out.newColumns = sample ? "present" : "no rows to check";
  } catch (err) {
    out.db = "FAILED";
    out.error = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 500) : String(err).slice(0, 500);
  }

  return NextResponse.json(out);
}

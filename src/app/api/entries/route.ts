/* POST /api/entries — log cases: a single manual entry or an RTA batch.
   The server is authoritative: verdicts land as sent (they were computed by
   the same shared engine), but the whole ledger re-settles its deduction caps
   before anything is stored. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { loadEntries, syncEntries, writeAudit, toEntry, type Entry } from "@/lib/db";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { buildCaseQuery } from "@/lib/entries-query.js";

/* GET /api/entries — a paginated, server-filtered window over the ledger.
   The database does the filtering, ordering and slicing, so a large history
   never has to be shipped whole. Staff only (agents read their own cases via
   the portal). Returns { entries, total, page, pageSize }. */
export const GET = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  if (actor.role === "Agent") throw new GuardError(403, "Agents read their own cases in the portal.");

  const p = new URL(req.url).searchParams;
  const { where, orderBy, skip, take, page, pageSize } = buildCaseQuery({
    account: p.get("account") || undefined,
    stage: p.get("stage") || undefined,
    q: p.get("q") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    includeVoided: p.get("includeVoided") === "1",
    page: Number(p.get("page")) || 1,
    pageSize: Number(p.get("pageSize")) || undefined,
  });

  // buildCaseQuery is plain JS, so narrow its shape to Prisma's types here.
  const w = where as Prisma.CaseWhereInput;
  const o = orderBy as Prisma.CaseOrderByWithRelationInput[];
  const [rows, total] = await Promise.all([
    prisma.case.findMany({ where: w, orderBy: o, skip, take }),
    prisma.case.count({ where: w }),
  ]);

  return NextResponse.json({ entries: rows.map(toEntry), total, page, pageSize });
});

export const POST = guarded(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const incoming: Entry[] = Array.isArray(body.entries) ? body.entries : body.entry ? [body.entry] : [];
  const fromRta = body.source === "rta";
  const actor = await requireRole(fromRta ? "upload" : "log");

  if (!incoming.length) throw new GuardError(400, "No entries supplied.");
  for (const e of incoming) {
    if (!e.id || !e.date || !e.violation || !e.account) {
      throw new GuardError(400, "Each entry needs id, date, account and violation.");
    }
  }

  const before = await loadEntries();
  const ids = new Set(before.map((e) => e.id));
  const fresh = incoming.filter((e) => !ids.has(e.id));
  const entries = await syncEntries(before, [...fresh, ...before]);

  await writeAudit({
    actor,
    action: fromRta ? "RTA_IMPORTED" : "CASE_CREATED",
    summary: fromRta
      ? `RTA import committed ${fresh.length} case(s).`
      : `Logged ${fresh.map((e) => `${e.violation} (${e.date})`).join(", ")}.`,
    caseId: fresh.length === 1 ? fresh[0].id : null,
    meta: { count: fresh.length },
  });

  return NextResponse.json({ entries });
});

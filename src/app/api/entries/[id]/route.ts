/* PATCH /api/entries/:id — pipeline updates on one case (notify, OPS confirm,
   HR execution, assignee, comments). DELETE — SuperAdmin only.
   Every write re-settles deduction caps and re-checks whether the case just
   became Closed and now owes the agent an acknowledgement. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { loadEntries, syncEntries, writeAudit, type Entry } from "@/lib/db";

export const PATCH = guarded(async (req: Request) => {
  const actor = await requireRole("caseWrite");
  const id = req.url.split("/").pop()!;
  const entry: Entry = (await req.json().catch(() => ({}))).entry;
  if (!entry || entry.id !== id) throw new GuardError(400, "Body must carry the entry with a matching id.");

  const before = await loadEntries();
  const existing = before.find((e) => e.id === id);
  if (!existing) throw new GuardError(404, "Case not found.");

  // Optimistic concurrency: the version token is the millisecond updatedAt the
  // API hands out. If the client echoes one back and the case has since been
  // written by someone else, refuse rather than clobber. Callers that omit it
  // (or send a non-numeric value) are not gated.
  const clientVer = typeof entry.updatedAt === "number" ? entry.updatedAt : null;
  const dbVer = typeof existing.updatedAt === "number" ? existing.updatedAt : null;
  if (clientVer != null && dbVer != null && clientVer !== dbVer) {
    throw new GuardError(409, "This case changed since you opened it — reload and reapply your edit.");
  }

  // The signature block is written only by the acknowledge endpoint —
  // whatever the client sent for it is discarded.
  const preserved = {
    requiresAcknowledgement: existing.requiresAcknowledgement,
    agentAcknowledgedAt: existing.agentAcknowledgedAt,
    agentSignature: existing.agentSignature,
  };

  const entries = await syncEntries(
    before,
    before.map((e) => (e.id === id ? { ...entry, ...preserved } : e))
  );

  await writeAudit({
    actor,
    action: "CASE_UPDATED",
    summary: `Updated case ${id} (${existing.violation}, ${existing.date}).`,
    caseId: id,
  });

  return NextResponse.json({ entries });
});

// DELETE soft-voids by default (reversible, audited, kept out of every metric).
// ?purge=1 permanently removes the row — a deliberate, irreversible SuperAdmin
// act reserved for genuine erasure (test rows, GDPR requests).
export const DELETE = guarded(async (req: Request) => {
  const actor = await requireRole("delete");
  const url = new URL(req.url);
  const id = url.pathname.split("/").pop()!;
  const purge = url.searchParams.get("purge") === "1";

  const before = await loadEntries();
  const existing = before.find((e) => e.id === id);
  if (!existing) throw new GuardError(404, "Case not found.");

  const label = `${existing.violation} · ${existing.email || existing.empId} · ${existing.date}`;

  if (purge) {
    const entries = await syncEntries(before, before.filter((e) => e.id !== id));
    await writeAudit({
      actor,
      action: "CASE_DELETED",
      summary: `Permanently deleted case ${id} (${label}).`,
      caseId: id,
      meta: { violation: existing.violation, date: existing.date, purge: true },
    });
    return NextResponse.json({ entries });
  }

  const stamped = {
    ...existing,
    voided: true,
    activity: [
      ...((existing.activity as unknown[]) || []),
      { at: Date.now(), by: actor.name, type: "voided", text: "Case voided (soft-deleted)." },
    ],
  };
  const entries = await syncEntries(before, before.map((e) => (e.id === id ? stamped : e)));
  await writeAudit({
    actor,
    action: "CASE_VOIDED",
    summary: `Voided case ${id} (${label}).`,
    caseId: id,
    meta: { violation: existing.violation, date: existing.date },
  });
  return NextResponse.json({ entries });
});

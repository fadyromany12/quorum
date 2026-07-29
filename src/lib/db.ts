/* The bridge between Prisma rows and the pure rules engine.

   Case columns were named to match the engine's entry shape, so mapping is
   thin: Date -> ms number for createdAt, Json -> array for activity, and null
   normalization. Everything downstream (verdicts, chains, caps, summaries)
   runs on the mapped objects unchanged. */

import type { Case, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
// The engine is plain JS — shared verbatim with the client bundle and tests.
import { settleDeductions } from "./deductions.js";
import { statusOf } from "./engine.js";

export type Entry = Record<string, unknown> & { id: string };

export function toEntry(row: Case): Entry {
  return {
    ...row,
    severity: row.severity ?? null,
    occurrence: row.occurrence ?? null,
    activity: Array.isArray(row.activity) ? row.activity : [],
    appealAt: row.appealAt ? row.appealAt.getTime() : null,
    appealResolvedAt: row.appealResolvedAt ? row.appealResolvedAt.getTime() : null,
    agentAcknowledgedAt: row.agentAcknowledgedAt ? row.agentAcknowledgedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
    // Exposed as an optimistic-concurrency token: the client echoes it back on a
    // PATCH and the route rejects the write if the DB has moved on. Never written
    // back (not in CASE_FIELDS) — Prisma's @updatedAt manages it.
    updatedAt: row.updatedAt.getTime(),
  };
}

const CASE_FIELDS = [
  "id", "account", "lob", "date", "email", "empId", "agentName", "tl", "executorName",
  "shiftStart", "shiftEnd", "violation", "sickNote", "tardyMin", "earlyMin", "compMin",
  "missingMin", "occurrence", "action", "executor", "severity", "disciplinary",
  "deductionDays", "deductionApplied", "reclassifiedFrom", "notes", "evidenceUrl", "voided", "stage", "assignee",
  "notified", "opsConfirmed", "hrNeeded", "hrConfirmed", "hrRef", "actionDate", "activity",
  "requiresAcknowledgement", "agentSignature",
] as const;

export function toRow(entry: Entry): Prisma.CaseUncheckedCreateInput {
  const row: Record<string, unknown> = {};
  for (const f of CASE_FIELDS) if (entry[f] !== undefined) row[f] = entry[f];
  if (typeof entry.createdAt === "number") row.createdAt = new Date(entry.createdAt);
  if (typeof entry.agentAcknowledgedAt === "number") row.agentAcknowledgedAt = new Date(entry.agentAcknowledgedAt);
  return row as Prisma.CaseUncheckedCreateInput;
}

export async function loadEntries(): Promise<Entry[]> {
  const rows = await prisma.case.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  return rows.map(toEntry);
}

/**
 * A disciplinary case that has just reached "Closed" owes the agent a digital
 * acknowledgement. Called on every entry mutation so the flag is set exactly
 * when HR/OPS finalize — never earlier, never twice.
 */
export function stampAcknowledgementFlag(entry: Entry): Entry {
  if (
    entry.disciplinary &&
    statusOf(entry) === "Closed" &&
    !entry.agentAcknowledgedAt &&
    !entry.requiresAcknowledgement
  ) {
    return { ...entry, requiresAcknowledgement: true };
  }
  return entry;
}

/**
 * Persist an engine-produced entries array: settle deduction caps across the
 * ledger, then write only the rows that actually changed. Runs inside one
 * transaction so a bulk decision can't half-apply.
 */
export async function syncEntries(before: Entry[], after: Entry[]): Promise<Entry[]> {
  const settled: Entry[] = settleDeductions(after).map(stampAcknowledgementFlag);
  const beforeById = new Map(before.map((e) => [e.id, e]));

  const changed = settled.filter((e) => {
    const prev = beforeById.get(e.id);
    return !prev || JSON.stringify(toRow(prev)) !== JSON.stringify(toRow(e));
  });
  const removedIds = before.filter((e) => !settled.some((s) => s.id === e.id)).map((e) => e.id);

  await prisma.$transaction([
    ...removedIds.map((id) => prisma.case.delete({ where: { id } })),
    ...changed.map((e) => {
      const row = toRow(e);
      return prisma.case.upsert({ where: { id: e.id }, create: row, update: row });
    }),
  ]);

  // Re-read so callers (and the client) get DB truth — crucially the fresh
  // updatedAt version, so a follow-up edit by the same user isn't mistaken for
  // a stale concurrent write.
  return loadEntries();
}

export async function writeAudit(opts: {
  actor: { id?: string | null; name: string; role: string };
  action: string;
  summary: string;
  caseId?: string | null;
  meta?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: opts.actor.id ?? null,
      actorName: opts.actor.name,
      actorRole: opts.actor.role,
      action: opts.action,
      caseId: opts.caseId ?? null,
      summary: opts.summary,
      meta: (opts.meta ?? {}) as Prisma.InputJsonValue,
    },
  });
}

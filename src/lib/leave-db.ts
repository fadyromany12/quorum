/* Leave-ledger persistence. The rules live in leave.js; this is the only place
   that talks to Postgres about balances.

   Idempotency here is structural, not procedural. The accrual sweep diffs the
   pure schedule against the rows that exist and writes only the gap, and the
   unique constraints turn any race it loses into a no-op: two sweeps landing
   together, or a retried settlement, converge on the same ledger instead of
   double-crediting it. */

import { prisma } from "./prisma";
import {
  accrualSchedule, missingAccruals, summarize, grantDebit, checkEntry,
} from "./leave.js";
import { isWorking, STAGES } from "./employee.js";
import { todayStr } from "./dates.js";

const WORKING = STAGES.filter(isWorking);
const UNIQUE_VIOLATION = "P2002";

const toEntry = (r: {
  id: string; at: Date; effectiveDate: string; type: string;
  days: unknown; monthKey: string | null; requestId: string | null; note: string;
}) => ({
  id: r.id,
  at: r.at.getTime(),
  effectiveDate: r.effectiveDate,
  type: r.type,
  days: Number(r.days),
  monthKey: r.monthKey ?? null,
  requestId: r.requestId ?? null,
  note: r.note,
});

/** The full ledger, oldest first — the explanation view reads it verbatim. */
export async function ledger(employeeId: string) {
  const rows = await prisma.leaveLedgerEntry.findMany({
    where: { employeeId },
    orderBy: [{ effectiveDate: "asc" }, { at: "asc" }],
    select: {
      id: true, at: true, effectiveDate: true, type: true,
      days: true, monthKey: true, requestId: true, note: true,
    },
  });
  return rows.map(toEntry);
}

/**
 * Balance plus its derivation for one employee — brought up to date first.
 *
 * Reading triggers the catch-up rather than waiting for a cron: the employee
 * asking is the moment the number matters, and a balance that is stale until
 * some job runs is a balance nobody trusts. The sweep is idempotent, so doing
 * it on read costs at most one no-op query when nothing is missing.
 */
export async function balance(employeeId: string) {
  await accrueFor(employeeId);
  const entries = await ledger(employeeId);
  return { ...summarize(entries), entries };
}

/** Write whatever the schedule says this employee's ledger is missing. */
async function accrueFor(employeeId: string) {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, hireDate: true, birthDate: true, stage: true },
  });
  if (!emp || !emp.hireDate) return { written: 0 };

  const entries = await prisma.leaveLedgerEntry.findMany({
    where: { employeeId, type: "accrual" },
    select: { monthKey: true, days: true, type: true },
  });
  const { missing } = missingAccruals(
    entries.map((e) => ({ ...e, days: Number(e.days) })),
    accrualSchedule(emp, todayStr()),
  );
  if (!missing.length) return { written: 0 };

  // skipDuplicates makes a lost race a no-op instead of a crash.
  const res = await prisma.leaveLedgerEntry.createMany({
    data: missing.map((m) => ({
      employeeId,
      type: "accrual",
      days: String(m.days),
      monthKey: m.monthKey,
      effectiveDate: m.effectiveDate,
      note: "Monthly accrual",
      actorName: "system",
    })),
    skipDuplicates: true,
  });
  return { written: res.count };
}

/**
 * The fleet-wide sweep, for the cron. Working stages only: an exited
 * employee's ledger is frozen where it stood, and crediting an applicant would
 * invent leave for someone who has not started.
 */
export async function sweepAccruals() {
  const people = await prisma.employee.findMany({
    where: { stage: { in: WORKING as never[] }, hireDate: { not: "" } },
    select: { id: true },
  });
  let written = 0;
  for (const p of people) written += (await accrueFor(p.id)).written;
  return { employees: people.length, written };
}

/**
 * Debit the ledger for a settled leave request. Called from the settlement
 * path; the unique requestId makes a retry a no-op, so the caller does not
 * need to know whether it already ran.
 */
export async function recordGrant(request: {
  id: string; type: string; status: string; grantedUnits: number | null;
  subjectId: string; payload?: unknown;
}) {
  const debit = grantDebit(request as never);
  if (!debit) return { recorded: false };
  try {
    await prisma.leaveLedgerEntry.create({
      data: {
        employeeId: request.subjectId,
        type: debit.type,
        days: String(debit.days),
        requestId: debit.requestId,
        effectiveDate: debit.effectiveDate,
        note: debit.note,
        actorName: "system",
      },
    });
    return { recorded: true };
  } catch (err) {
    if ((err as { code?: string })?.code === UNIQUE_VIOLATION) return { recorded: false };
    throw err;
  }
}

/**
 * A manual correction, HR-only at the route. Validated by the pure rules —
 * including that free-direction types must say why — and attributed.
 */
export async function adjust(
  employeeId: string,
  input: { type: string; days: number; note?: string; effectiveDate?: string },
  actorName: string,
) {
  const check = checkEntry(input);
  if (!check.ok) return { ok: false as const, status: 400, reason: check.reason };

  const entry = await prisma.leaveLedgerEntry.create({
    data: {
      employeeId,
      type: input.type,
      days: String(check.days),
      effectiveDate: input.effectiveDate ?? todayStr(),
      note: String(input.note ?? ""),
      actorName,
    },
  });
  return { ok: true as const, entry: toEntry(entry as never) };
}

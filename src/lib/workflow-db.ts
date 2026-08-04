/* Request persistence. The rules live in workflow.js; this is the only place
   that talks to Postgres about requests, steps and delegations.

   The engine is pure and works on plain objects, so this file's real job is
   translation: Prisma rows in, engine shapes out, and back. Two mismatches are
   handled here rather than being allowed to leak into the engine —

     · Prisma columns default to "" where the engine expects null. An empty
       string is not "no proposal", and treating it as one makes an unagreed
       co-approval look agreed.
     · Decimal comes back as a Decimal instance, not a number. Left unconverted
       it compares and arithmetics wrongly, silently. */

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  chainFor, decide as decideStep, statusOf, canWithdraw, autoResolve,
  grantedUnitsOf, inboxFor, slaFor, escalations, canRaise, REQUEST_TYPES,
} from "./workflow.js";
import { todayStr } from "./dates.js";
import { recordGrant } from "./leave-db";
import { verifiedChangeSet } from "./profile-policy.js";
import { swapPlan, overtimeRow } from "./schedule.js";
import { promotionEffects } from "./promotion.js";
import { PAY_REASONS } from "./comp.js";
import { writePii } from "./employee-db";
import { writeAudit } from "./db";

export type Actor = { id?: string; name: string; role: string };

const num = (v: unknown) => (v == null ? null : Number(v));
const orNull = (v: unknown) => (v === "" || v == null ? null : v);

const STEP_SELECT = {
  id: true, order: true, kind: true, approverId: true, state: true,
  decidedAt: true, decidedById: true, note: true, grantedUnits: true, proposedValue: true,
} satisfies Prisma.RequestStepSelect;

const REQUEST_SELECT = {
  id: true, type: true, subjectId: true, raisedById: true, raisedOn: true,
  payload: true, requestedUnits: true, proposedValue: true,
  settledAt: true, withdrawnAt: true, autoResolvedAt: true, createdAt: true,
  steps: { select: STEP_SELECT, orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
  subject: { select: { id: true, empId: true, fullNameEn: true, preferredName: true, account: true } },
} satisfies Prisma.RequestSelect;

type Row = Prisma.RequestGetPayload<{ select: typeof REQUEST_SELECT }>;

/** Prisma row → the shape workflow.js expects. */
export function toRequest(r: Row) {
  return {
    id: r.id,
    type: r.type,
    subjectId: r.subjectId,
    raisedById: r.raisedById,
    raisedOn: r.raisedOn,
    payload: r.payload,
    requestedUnits: num(r.requestedUnits),
    proposedValue: orNull(r.proposedValue) as string | null,
    withdrawnAt: r.withdrawnAt ? r.withdrawnAt.getTime() : null,
    autoResolvedAt: r.autoResolvedAt ? r.autoResolvedAt.getTime() : null,
    settledAt: r.settledAt ? r.settledAt.getTime() : null,
    createdAt: r.createdAt.getTime(),
    subject: r.subject,
    steps: r.steps.map((s) => ({
      id: s.id,
      order: s.order,
      kind: s.kind,
      approverId: s.approverId,
      state: s.state,
      decidedAt: s.decidedAt ? s.decidedAt.getTime() : null,
      decidedBy: s.decidedById,
      note: s.note,
      grantedUnits: num(s.grantedUnits),
      proposedValue: orNull(s.proposedValue) as string | null,
    })),
  };
}

/* The engine's Request type declares `id` optional, because a chain can be built
   before a row exists. Everything that reaches this file has been persisted and
   therefore has one — asserted once here, at the boundary, rather than
   re-checked at every call site. */
type Persisted = ReturnType<typeof toRequest>;
const persisted = (r: unknown) => r as Persisted;

/** The derived view a client needs: status, grant, SLA, and the agreed value. */
export function decorate(req: ReturnType<typeof toRequest>, today = todayStr()) {
  return {
    ...req,
    status: statusOf(req),
    grantedUnits: grantedUnitsOf(req),
    sla: slaFor(req, today),
    config: REQUEST_TYPES[req.type as keyof typeof REQUEST_TYPES] ?? null,
  };
}

/** Active delegations, in the shape the engine walks. */
export async function loadDelegations() {
  const rows = await prisma.delegation.findMany({
    where: { revoked: false },
    select: { approverId: true, delegateId: true, from: true, to: true, revoked: true },
  });
  return rows;
}

/* ── Raising ────────────────────────────────────────────────────────────────*/

/**
 * Raise a request, building its chain from the subject's reporting lines.
 *
 * The chain is materialised at creation rather than resolved on every read, so a
 * later reorganisation cannot silently redirect a request that is already in
 * flight — the approvers who were asked stay the approvers who were asked.
 */
export async function raiseRequest(
  input: {
    type: string;
    subjectId: string;
    payload?: Prisma.InputJsonValue;
    requestedUnits?: number | null;
    proposedValue?: string;
  },
  actor: Actor & { employeeId?: string },
) {
  const cfg = REQUEST_TYPES[input.type as keyof typeof REQUEST_TYPES];
  if (!cfg) return { ok: false as const, status: 400, reason: `Unknown request type "${input.type}".` };

  const subject = await prisma.employee.findUnique({
    where: { id: input.subjectId },
    select: {
      id: true, fullNameEn: true, empId: true, stage: true,
      directManagerId: true, functionalManagerId: true, dottedManagerId: true,
    },
  });
  if (!subject) return { ok: false as const, status: 404, reason: "No such employee." };

  // HR and finance approver pools, for the chains that need them.
  const [hr, fin] = await Promise.all([
    prisma.employee.findMany({
      where: { user: { role: "HRBusinessPartner", active: true } },
      select: { id: true },
    }),
    prisma.employee.findMany({
      where: { user: { role: "SuperAdmin", active: true } },
      select: { id: true },
    }),
  ]);

  const chain = chainFor(input.type, subject, {
    hrIds: hr.map((e) => e.id),
    financeIds: fin.map((e) => e.id),
  });
  if (!chain.ok) return { ok: false as const, status: 409, reason: chain.reason };

  const created = await prisma.request.create({
    data: {
      type: input.type,
      subjectId: subject.id,
      raisedById: actor.employeeId ?? subject.id,
      raisedOn: todayStr(),
      payload: input.payload ?? {},
      requestedUnits: input.requestedUnits == null ? null : String(input.requestedUnits),
      proposedValue: input.proposedValue ?? "",
      steps: {
        create: chain.steps.map((s) => ({
          order: s.order,
          kind: s.kind,
          approverId: s.approverId,
          state: "pending",
        })),
      },
    },
    select: REQUEST_SELECT,
  });

  return { ok: true as const, request: decorate(toRequest(created)) };
}

/* ── Deciding ───────────────────────────────────────────────────────────────*/

/**
 * Record a decision.
 *
 * The engine decides validity and produces the new step list; this writes it and
 * stamps `settledAt` when the request leaves pending — in the same transaction,
 * so a settled request can never be missing its marker.
 */
export async function decideRequest(
  requestId: string,
  action: { decision: "approve" | "reject"; grantedUnits?: number; proposedValue?: string; note?: string },
  actor: Actor & { employeeId?: string },
) {
  if (!actor.employeeId) {
    return { ok: false as const, status: 409, reason: "Your login is not linked to an employment record yet." };
  }

  const row = await prisma.request.findUnique({ where: { id: requestId }, select: REQUEST_SELECT });
  if (!row) return { ok: false as const, status: 404, reason: "No such request." };

  const req = toRequest(row);
  const delegations = await loadDelegations();
  const today = todayStr();

  /* Which step is this actor allowed to act on? They may be the approver, or
     someone's delegate — so the step is found by testing each pending step
     rather than by matching the actor's own id, which would miss delegations. */
  const { pendingSteps, actingIdsFor } = await import("./workflow.js");
  const mine = pendingSteps(req).find((s: { approverId: string }) =>
    actingIdsFor(s.approverId, delegations, today).includes(actor.employeeId!));
  if (!mine) return { ok: false as const, status: 403, reason: "This request is not waiting on you." };

  const result = decideStep(
    req,
    { approverId: mine.approverId, actorId: actor.employeeId, ...action },
    { delegations, today },
  );
  if (!result.ok) return { ok: false as const, status: 409, reason: result.reason };

  const after = result.request;
  const settled = statusOf(after) !== "pending";

  await prisma.$transaction(async (tx) => {
    for (const s of after.steps) {
      if (!s.id) continue;
      await tx.requestStep.update({
        where: { id: s.id },
        data: {
          state: s.state,
          decidedAt: s.decidedAt ? new Date(s.decidedAt) : null,
          decidedById: s.decidedBy ?? null,
          note: s.note ?? "",
          grantedUnits: s.grantedUnits == null ? null : String(s.grantedUnits),
          proposedValue: s.proposedValue ?? "",
        },
      });
    }
    await tx.request.update({
      where: { id: requestId },
      data: { settledAt: settled ? new Date() : null },
    });
  });

  const fresh = await prisma.request.findUnique({ where: { id: requestId }, select: REQUEST_SELECT });
  const final = decorate(toRequest(fresh as Row));

  /* Settlement is the moment leave is actually spent, so the ledger debit
     happens here — and the unique requestId makes a retry a no-op, so a crash
     between the update above and this line self-heals on the next read. */
  if (settled) await recordGrant(final as never);

  /* A verified profile change applies at approval and only then. The change
     set is re-derived from the policy here rather than trusted from the
     payload — the payload travelled through a browser, and only fields the
     policy marks as verified survive. Applying is idempotent: writing the
     same values twice is the same write. */
  if (settled && final.type === "profileChange" && final.status === "approved") {
    const payload = (final.payload ?? {}) as { fields?: Record<string, unknown> };
    const cs = verifiedChangeSet(payload.fields ?? {});
    if (Object.keys(cs.employee).length) {
      await prisma.employee.update({ where: { id: final.subjectId }, data: cs.employee });
    }
    if (Object.keys(cs.pii).length) {
      // Through writePii, so an approved change to an IBAN lands encrypted like
      // every other write — a second path to the same columns is a second path
      // to storing them in the clear.
      await writePii(final.subjectId, cs.pii as Record<string, string>);
    }
  }

  /* An approved swap moves the two roster rows. Re-checked here rather than
     trusted from the payload: the request may have sat for two days, and either
     shift can have been rescheduled, reassigned or deleted in between. A swap
     that was valid when proposed and is not now must fail loudly rather than
     write a roster nobody can work. */
  if (settled && final.type === "shiftSwap" && final.status === "approved") {
    const payload = (final.payload ?? {}) as { mineId?: string; theirsId?: string };
    const [mine_, theirs] = await Promise.all([
      prisma.scheduleEntry.findUnique({ where: { id: String(payload.mineId ?? "") } }),
      prisma.scheduleEntry.findUnique({ where: { id: String(payload.theirsId ?? "") } }),
    ]);
    const plan = swapPlan(mine_, theirs);
    if (plan.ok) {
      const moves = plan.rows as Array<{ id: string; employeeId: string }>;
      await prisma.$transaction(
        moves.map((r) => prisma.scheduleEntry.update({ where: { id: r.id }, data: { employeeId: r.employeeId } })),
      );
    } else {
      /* Approved but unapplicable. Recorded rather than swallowed — the lead
         pressed approve and is entitled to know the roster did not move. */
      await writeAudit({
        actor: { name: "system", role: "system" },
        action: "SWAP_NOT_APPLIED",
        summary: `An approved shift swap could not be applied — ${plan.reason}`,
        meta: { requestId, reason: plan.reason },
      });
    }
  }

  /* Approved overtime becomes the roster row payroll reads.

     Until now this loop was open: the request existed, the approval happened,
     and nothing was written — while payslips price overtime by counting roster
     rows whose activity is "Overtime". So the agent worked the hours, the
     manager said yes, and the money never moved.

     grantedUnitsOf() rather than requestedUnits, because an approver who allows
     two of the four hours asked for has approved two. Paying the ask instead of
     the grant is the error that costs money in the direction nobody notices.

     The upsert is keyed on employee + date + start time, so a retried
     settlement converges on one row instead of paying twice. */
  if (settled && final.type === "overtime") {
    const row = overtimeRow(final, grantedUnitsOf(final as never));
    if (row) {
      await prisma.scheduleEntry.upsert({
        where: {
          employeeId_date_startTime: {
            employeeId: row.employeeId,
            date: row.date,
            startTime: row.startTime,
          },
        },
        create: {
          ...row,
          published: true,
          actorName: "approval",
          actorRole: "system",
        },
        update: {
          activity: row.activity,
          durationMinutes: row.durationMinutes,
          note: row.note,
          published: true,
        },
      });
    }
  }

  /* An approved promotion applies all four of its parts, together.

     Re-derived from the payload through promotionEffects() rather than trusted
     field by field — the payload travelled through a browser, and one of these
     four is a login role. That function drops any role outside the grantable
     list, so the last gate before the write is the same one the form used.

     Only on "approved". A promotion has no coherent partial state: granting the
     title while withholding the access is the exact half-promotion this whole
     feature exists to prevent. */
  if (settled && final.type === "promotion" && final.status === "approved") {
    const fx = promotionEffects((final.payload ?? {}) as Record<string, unknown>);

    await prisma.$transaction(async (tx) => {
      if (Object.keys(fx.employee).length) {
        await tx.employee.update({ where: { id: final.subjectId }, data: fx.employee });
      }

      /* The access change. Guarded by the employee actually having a login —
         a promotion for someone not yet given one must not fail the whole
         transaction, it simply has no role to change. */
      if (fx.role) {
        const emp = await tx.employee.findUnique({
          where: { id: final.subjectId },
          select: { userId: true, fullNameEn: true },
        });
        if (emp?.userId) {
          await tx.user.update({ where: { id: emp.userId }, data: { role: fx.role as never } });
        }
      }

      if (fx.compensation) {
        /* `reason` is an enum in the database and a string in the payload.
           checkPromotion() already refuses anything outside PAY_REASONS, so
           this is belt and braces — but the payload came through a browser and
           a rejected enum would fail the whole transaction at write time
           rather than at validation, which is the worst place to find out. */
        const reason = (PAY_REASONS as readonly string[]).includes(fx.compensation.reason)
          ? (fx.compensation.reason as never)
          : ("Promotion" as never);
        await tx.compensationRecord.create({
          data: {
            employeeId: final.subjectId,
            baseSalary: fx.compensation.baseSalary,
            currency: fx.compensation.currency,
            reason,
            effectiveFrom: fx.compensation.effectiveFrom,
            note: fx.compensation.note,
            actorName: "approval",
          },
        });
      }
    });

    /* A role change is an escalation, so it is audited on its own rather than
       only as part of "promotion approved" — the question an auditor asks is
       "when did this account gain that access", and it should be answerable
       without reading request payloads. */
    if (fx.role) {
      await writeAudit({
        actor: { name: "approval", role: "system" },
        action: "ROLE_CHANGED",
        summary: `An approved promotion set the login role to ${fx.role}.`,
        meta: { employeeId: final.subjectId, role: fx.role, requestId },
      });
    }
  }

  return { ok: true as const, request: final, viaDelegation: mine.approverId !== actor.employeeId };
}

/* ── Withdrawing ────────────────────────────────────────────────────────────*/

export async function withdrawRequest(requestId: string, actor: Actor & { employeeId?: string }) {
  const row = await prisma.request.findUnique({ where: { id: requestId }, select: REQUEST_SELECT });
  if (!row) return { ok: false as const, status: 404, reason: "No such request." };

  const req = toRequest(row);
  const check = canWithdraw(req, actor.employeeId, todayStr());
  if (!check.ok) return { ok: false as const, status: 409, reason: check.reason };

  const now = new Date();
  await prisma.$transaction([
    prisma.requestStep.updateMany({
      where: { requestId, state: "pending" },
      data: { state: "skipped" },
    }),
    prisma.request.update({ where: { id: requestId }, data: { withdrawnAt: now, settledAt: now } }),
  ]);

  const fresh = await prisma.request.findUnique({ where: { id: requestId }, select: REQUEST_SELECT });
  return { ok: true as const, request: decorate(toRequest(fresh as Row)) };
}

/* ── Reading ────────────────────────────────────────────────────────────────*/

const OPEN = { settledAt: null };

/** Everything waiting on this person, including work held by delegation. */
export async function inbox(employeeId: string) {
  const [rows, delegations] = await Promise.all([
    prisma.request.findMany({ where: OPEN, select: REQUEST_SELECT, orderBy: { createdAt: "asc" } }),
    loadDelegations(),
  ]);
  const today = todayStr();
  const items = inboxFor(employeeId, rows.map(toRequest), { delegations, today });
  return items.map((i) => ({ ...i, request: decorate(persisted(i.request), today) }));
}

/** Requests about, or raised by, this person. Bounded. */
export async function myRequests(employeeId: string, limit = 50) {
  const rows = await prisma.request.findMany({
    where: { OR: [{ subjectId: employeeId }, { raisedById: employeeId }] },
    select: REQUEST_SELECT,
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, limit)),
  });
  const today = todayStr();
  return rows.map((r) => decorate(toRequest(r), today));
}

/** Open requests past their SLA, worst first. For the escalation job and view. */
export async function overdue() {
  const rows = await prisma.request.findMany({ where: OPEN, select: REQUEST_SELECT });
  const today = todayStr();
  return escalations(rows.map(toRequest), today).map((e) => ({
    ...e,
    request: decorate(persisted(e.request), today),
  }));
}

/* ── The timeout sweeper ────────────────────────────────────────────────────*/

/**
 * Apply co-approval timeout defaults.
 *
 * Idempotent: it re-derives from the steps each run and only acts on requests
 * still pending past their window, so running it twice changes nothing the
 * second time.
 */
export async function sweepAutoResolve() {
  const rows = await prisma.request.findMany({ where: OPEN, select: REQUEST_SELECT });
  const today = todayStr();
  const resolved: Array<{ id: string; value: string }> = [];

  for (const row of rows) {
    const req = toRequest(row);
    const r = autoResolve(req, today);
    if (!r.applies) continue;

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const s of r.request.steps) {
        if (!s.id) continue;
        await tx.requestStep.update({
          where: { id: s.id },
          data: {
            state: s.state,
            decidedAt: s.decidedAt ? new Date(s.decidedAt) : null,
            decidedById: s.decidedBy ?? null,
            note: s.note ?? "",
            proposedValue: s.proposedValue ?? "",
          },
        });
      }
      await tx.request.update({
        where: { id: row.id },
        data: { autoResolvedAt: now, settledAt: now, proposedValue: r.value },
      });
    });
    resolved.push({ id: row.id, value: r.value });
  }

  return { resolved: resolved.length, requests: resolved };
}

/* ── Delegation ─────────────────────────────────────────────────────────────*/

export async function setDelegation(
  approverId: string,
  input: { delegateId: string; from?: string; to?: string; note?: string },
) {
  if (input.delegateId === approverId) {
    return { ok: false as const, status: 400, reason: "You cannot delegate to yourself." };
  }
  const delegate = await prisma.employee.findUnique({ where: { id: input.delegateId }, select: { id: true } });
  if (!delegate) return { ok: false as const, status: 404, reason: "No such employee." };

  /* Only one live delegation per approver. A second would make "who may act"
     ambiguous, and the engine would silently follow whichever it read first. */
  const created = await prisma.$transaction(async (tx) => {
    await tx.delegation.updateMany({ where: { approverId, revoked: false }, data: { revoked: true } });
    return tx.delegation.create({
      data: {
        approverId,
        delegateId: input.delegateId,
        from: input.from ?? "",
        to: input.to ?? "",
        note: input.note ?? "",
      },
    });
  });
  return { ok: true as const, delegation: created };
}

export async function revokeDelegations(approverId: string) {
  const r = await prisma.delegation.updateMany({ where: { approverId, revoked: false }, data: { revoked: true } });
  return { revoked: r.count };
}

export async function myDelegation(approverId: string) {
  return prisma.delegation.findFirst({
    where: { approverId, revoked: false },
    orderBy: { createdAt: "desc" },
    select: { id: true, delegateId: true, from: true, to: true, note: true, createdAt: true },
  });
}

export { canRaise };

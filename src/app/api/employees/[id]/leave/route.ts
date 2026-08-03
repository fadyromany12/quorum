/* GET  /api/employees/[id]/leave — this person's balance and the ledger behind it.
   POST — a manual correction.

   The correction path exists because a ledger that only ever accrues and debits
   cannot represent the two things that are true on the day a system goes live:
   people already have balances, and some of those balances are wrong.

     · An opening balance. Someone hired in 2019 does not start at zero because
       this application started in 2026. Without a way to enter what they had,
       every long-serving employee's first payslip understates them.
     · A correction. A day recorded against the wrong person, a settlement
       reversed after an appeal, carry-over that should have expired.

   Both are appended, never edited. The ledger is the derivation of the balance,
   so rewriting a row would change history rather than record it — and "why is
   my balance different from last month" has to stay answerable.

   HR-only, because this is the one place in the leave system where a number can
   be set rather than derived. An adjustment is worth money, so it is attributed
   by name, audited, and — for the free-direction types that can go either way —
   refused unless it says why. That last rule lives in leave.js and is enforced
   by adjust(); the route does not restate it. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { writeAudit } from "@/lib/db";
import { assertVisibleEmployee } from "@/lib/employee-db";
import { prisma } from "@/lib/prisma";
import { balance, adjust } from "@/lib/leave-db";
import { LEDGER_TYPES } from "@/lib/leave.js";
import { can } from "@/lib/auth.js";

const idFrom = (req: Request) => {
  const p = new URL(req.url).pathname.split("/").filter(Boolean);
  return p[p.length - 2]; // .../employees/<id>/leave
};

/* Which types HR may enter by hand. `accrual` and `grant` are deliberately
   absent: those are written by the accrual sweep and by request settlement, and
   letting someone type one in by hand would put a row in the ledger that no
   schedule and no request can account for. A correction to either is an
   `adjustment`, which is what that type is for. */
const MANUAL_TYPES = ["adjustment", "expiry", "reversal"] as const;
type ManualType = (typeof MANUAL_TYPES)[number];

/* A predicate rather than a plain `.includes`, so the check that rejects an
   unknown type is the same check that lets the rest of the handler index
   LEDGER_TYPES safely. Validating and narrowing separately is how the two drift
   apart. */
const isManualType = (t: string): t is ManualType =>
  (MANUAL_TYPES as readonly string[]).includes(t);

/* "a adjustment" reads as a bug in the audit trail, which is the one log a
   person outside the team is most likely to read. Vowel-initial is the whole
   rule here — the ledger labels are a closed set of five and none of them is an
   "hour" or a "union". */
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("employeeRead");
  const id = idFrom(req);
  await assertVisibleEmployee(actor, id);

  const led = await balance(id);
  return NextResponse.json({
    ...led,
    /* Whether this caller may correct the ledger, answered by the same can()
       the POST enforces with. The panel needs to know before it renders a form,
       and a component that decided for itself would be a second opinion about
       permissions — the kind that is still showing the button months after the
       permission moved. */
    canAdjust: can(actor, "hr"),
    /* The vocabulary travels with the data so the screen does not keep its own
       copy of the type list — the same reason the guide is derived. */
    types: MANUAL_TYPES.map((t) => ({
      code: t,
      label: LEDGER_TYPES[t].label,
      sign: LEDGER_TYPES[t].sign,
      needsNote: LEDGER_TYPES[t].sign === 0,
    })),
  });
});

export const POST = guarded(async (req: Request) => {
  /* `hr` rather than `employeeWrite`: this is money, and the people who may
     edit a job title are not automatically the people who may hand someone
     five days of leave. */
  const actor = await requireRole("hr");
  const id = idFrom(req);
  await assertVisibleEmployee(actor, id);

  const body = await req.json().catch(() => ({}));
  const type = String(body.type ?? "");
  if (!isManualType(type)) {
    throw new GuardError(400, `"${type}" is not a correction HR enters by hand. Use ${MANUAL_TYPES.join(", ")}.`);
  }

  const employee = await prisma.employee.findUnique({
    where: { id },
    select: { fullNameEn: true },
  });
  if (!employee) throw new GuardError(404, "No such employee.");

  const result = await adjust(
    id,
    {
      type,
      days: Number(body.days),
      note: String(body.note ?? ""),
      effectiveDate: body.effectiveDate ? String(body.effectiveDate) : undefined,
    },
    actor.name ?? "",
  );
  if (!result.ok) throw new GuardError(result.status, result.reason);

  const { entry } = result;
  /* The audit line carries the number and the reason, because unlike a phone
     number those *are* the record of what was done — an adjustment logged
     without its size says nothing an auditor can use. */
  await writeAudit({
    actor,
    action: "LEAVE_ADJUSTED",
    summary:
      `${actor.name} recorded ${article(LEDGER_TYPES[type].label)} ` +
      `${LEDGER_TYPES[type].label.toLowerCase()} of ` +
      `${entry.days > 0 ? "+" : ""}${entry.days} days for ${employee.fullNameEn}` +
      `${entry.note ? ` — ${entry.note}` : ""}.`,
    meta: { employeeId: id, type, days: entry.days, effectiveDate: entry.effectiveDate },
  });

  // The fresh balance, so the caller never has to guess what the sum became.
  const led = await balance(id);
  return NextResponse.json({ entry, ...led });
});

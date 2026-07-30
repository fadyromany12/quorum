/* POST /api/attendance/punch — log in, log out, or change AUX state.

   The time is assigned here, never accepted from the request: an agent who can
   choose their own punch time can choose their own adherence. The body carries
   what happened, not when. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { punch, myDay } from "@/lib/attendance-db";
import { can } from "@/lib/auth.js";
import { isAux, EVENT_TYPES } from "@/lib/attendance.js";
import { isWorking } from "@/lib/employee.js";

export const POST = guarded(async (req: Request) => {
  // No permission beyond being signed in: punching for yourself is what every
  // role does, and the target check below is what actually constrains this.
  const actor = await requireRole(null);
  const body = await req.json().catch(() => ({}));

  const type = String(body.type ?? "");
  if (!EVENT_TYPES.includes(type)) {
    throw new GuardError(400, `Punch type must be one of ${EVENT_TYPES.join(", ")}.`);
  }
  if (type === "AUX" && !isAux(body.aux)) {
    throw new GuardError(400, `Unknown state "${body.aux ?? ""}".`);
  }

  const me = await prisma.employee.findUnique({
    where: { userId: actor.id },
    select: { id: true, stage: true, fullNameEn: true },
  });

  /* Punching for someone else is a separate, narrower permission. Defaulting the
     target to the caller means the ordinary case needs no id at all, which is
     also what stops a client from having to know its own employee id. */
  const targetEmpId = body.employeeId ? String(body.employeeId) : null;
  const forSelf = !targetEmpId || targetEmpId === me?.id;

  if (!forSelf && !can(actor, "punchOthers")) {
    throw new GuardError(403, "Your role cannot punch on someone else's behalf.");
  }

  const target = forSelf
    ? me
    : await prisma.employee.findUnique({
        where: { id: targetEmpId! },
        select: { id: true, stage: true, fullNameEn: true },
      });

  if (!target) {
    throw new GuardError(
      forSelf ? 409 : 404,
      forSelf ? "Your login is not linked to an employment record yet — HR can link it." : "No such employee.",
    );
  }

  /* Someone who has left, or has not started, must not be able to clock in.
     Attendance for a non-working stage is not a small data-quality problem: it
     feeds payroll hours. */
  if (!isWorking(target.stage)) {
    throw new GuardError(409, `${forSelf ? "You are" : `${target.fullNameEn} is`} not in a working stage (${target.stage}).`);
  }

  const result = await punch(
    target.id,
    { type: type as "LOGIN" | "LOGOUT" | "AUX", aux: body.aux, note: String(body.note ?? "") },
    actor,
    { forSelf },
  );
  if (!result.ok) throw new GuardError(result.status, result.reason);

  // The caller gets the resulting state back, so the UI never has to guess what
  // the punch did or fire a second request to find out.
  const day = await myDay(target.id);
  return NextResponse.json({ duplicate: result.duplicate, ...day });
});

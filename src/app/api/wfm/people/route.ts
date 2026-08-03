/* GET /api/wfm/people?account=&lob=
   The people a roster can be built from — and nothing else about them.

   WFM deliberately does not hold `employeeRead`. Rostering needs a name, an id
   and a placement; the directory carries phone numbers, hire dates, managers,
   probation dates and a route to the identifiers behind them. Reusing
   /api/employees here would have been one line of code and a quiet widening of
   what a planner can see about every person on the floor.

   So this returns five fields. If rostering ever needs a sixth, adding it here
   is a visible decision rather than something that arrived by inheritance.

   Only people who can actually be rostered come back. An applicant has not
   started, a leaver has gone, and putting either on next week's schedule is a
   mistake the list should not make possible in the first place. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { visibilityScope } from "@/lib/employee-db";

/** Stages that can hold a shift. Probation included — a new joiner works
    shifts from their first day, that is rather the point of probation. */
const ROSTERABLE = ["Probation", "Active", "OnPip", "Notice"] as const;

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("wfmRead");
  const q = new URL(req.url).searchParams;
  const account = q.get("account") ?? "";
  const lob = q.get("lob") ?? "";
  if (!account) throw new GuardError(400, "An account is required — a roster covers one queue.");

  /* The same subtree narrowing the directory uses. A lead building their own
     team's roster sees their own team, not the account. */
  const scope = await visibilityScope(actor);

  const people = await prisma.employee.findMany({
    where: {
      account,
      ...(lob ? { lob } : {}),
      stage: { in: [...ROSTERABLE] },
      ...(scope ? { id: { in: scope } } : {}),
    },
    select: { id: true, empId: true, fullNameEn: true, lob: true, stage: true },
    orderBy: [{ lob: "asc" }, { fullNameEn: "asc" }],
  });

  return NextResponse.json({ people, rosterable: ROSTERABLE });
});

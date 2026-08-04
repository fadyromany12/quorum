/* GET /api/org — the reporting chart, and what is wrong with it.

   Scoped the same way the directory is: a lead gets their own subtree, fleet-
   wide roles get everyone. That is not a smaller convenience — an org endpoint
   that ignores visibility scope is a directory dump with a different name.

   The structural checks run over whatever the caller can see, which is the
   honest thing: a lead is told about a loop inside their own team and not about
   one three branches away that is not theirs to fix. */

import { NextResponse } from "next/server";
import { requireRole, guarded } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { visibilityScope } from "@/lib/employee-db";
import { buildTree, checkHierarchy, skipLevelIds, managesManagers } from "@/lib/hierarchy.js";

export const GET = guarded(async () => {
  const actor = await requireRole("employeeRead");
  const scope = await visibilityScope(actor);

  const employees = await prisma.employee.findMany({
    where: {
      // Exited people are not on the chart; their reports have been moved or
      // are orphans, and the checker will say so either way.
      stage: { not: "Exited" },
      ...(scope ? { id: { in: scope } } : {}),
    },
    select: {
      id: true, empId: true, fullNameEn: true, preferredName: true, jobTitle: true,
      account: true, department: true, stage: true, directManagerId: true,
    },
    orderBy: { fullNameEn: "asc" },
  });

  const me = await prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
  const { roots, cycles } = buildTree(employees);
  const { problems, warnings } = checkHierarchy(employees);

  return NextResponse.json({
    roots,
    problems,
    warnings,
    cycles: cycles.length,
    total: employees.length,
    me: me
      ? {
          id: me.id,
          /* The skip level is what makes a manager of managers different from a
             manager, so it is named rather than left for the client to infer
             from the tree it happens to have been sent. */
          skipLevel: skipLevelIds(me.id, employees).length,
          managesManagers: managesManagers(me.id, employees),
        }
      : null,
  });
});

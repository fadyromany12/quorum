/* The staff workspace route: server guard, server-fetched initial state,
   client Workspace for everything interactive. Agents never land here. */

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadEntries } from "@/lib/db";
import { publicUser } from "@/lib/users-public";
import Workspace from "@/components/Workspace.jsx";
import { getThemeIntent } from "@/lib/theme-server";
import { visibilityScope } from "@/lib/employee-db";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.mustChange) redirect("/change-password");
  if (session.user.role === "Agent") redirect("/agent-portal");

  /* Headcount by lifecycle stage, so the scorecard strip can lead with where
     people are in the journey rather than with how many of them are in trouble.
     A groupBy rather than a fetch-and-count: the numbers are the only thing
     needed and the rows would be thrown away. Scoped like the directory, so a
     lead's tiles agree with the screens the tiles link to. */
  const actor = { id: session.user.id, name: session.user.name ?? "", role: session.user.role };
  const scopeIds = await visibilityScope(actor);
  const [entries, dcm, config, users, stageRows] = await Promise.all([
    loadEntries(),
    prisma.dcmRule.findMany({ orderBy: { sort: "asc" } }),
    prisma.appConfig.findUnique({ where: { id: 1 } }),
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.employee.groupBy({
      by: ["stage"],
      _count: { _all: true },
      ...(scopeIds ? { where: { id: { in: scopeIds } } } : {}),
    }),
  ]);
  const headcount: Record<string, number> = {};
  for (const r of stageRows) headcount[r.stage] = r._count._all;

  const initial = {
    entries,
    dcm,
    accounts: (config?.accounts as string[]) ?? [],
    tls: (config?.tls as string[]) ?? [],
    users: users.map(publicUser),
    headcount,
  };

  const me = {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    role: session.user.role,
  };

  const themeIntent = await getThemeIntent();

  return <Workspace initial={initial} me={me} themeIntent={themeIntent} />;
}

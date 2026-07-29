/* The staff workspace route: server guard, server-fetched initial state,
   client Workspace for everything interactive. Agents never land here. */

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadEntries } from "@/lib/db";
import { publicUser } from "@/lib/users-public";
import Workspace from "@/components/Workspace.jsx";
import { getThemeIntent } from "@/lib/theme-server";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.mustChange) redirect("/change-password");
  if (session.user.role === "Agent") redirect("/agent-portal");

  const [entries, dcm, config, users] = await Promise.all([
    loadEntries(),
    prisma.dcmRule.findMany({ orderBy: { sort: "asc" } }),
    prisma.appConfig.findUnique({ where: { id: 1 } }),
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const initial = {
    entries,
    dcm,
    accounts: (config?.accounts as string[]) ?? [],
    tls: (config?.tls as string[]) ?? [],
    users: users.map(publicUser),
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

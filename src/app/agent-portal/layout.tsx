/* The agent route group: only the Agent role gets past this layout. Staff
   roles are bounced to their workspace, the signed-out to login, and unset
   default passwords to the change screen. */

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { UserRound } from "lucide-react";
import { GlassBadge } from "@/components/glass";
import SignOutButton from "@/components/portal/SignOutButton";
import Logo from "@/components/Logo";
import LangToggle from "@/components/LangToggle";
import ThemeToggle from "@/components/ThemeToggle";
import GuideButton from "@/components/GuideButton";
import Tip from "@/components/ui/Tip";
import { getThemeIntent } from "@/lib/theme-server";
import { getLocale } from "@/lib/locale";
import { dirFor, t } from "@/lib/i18n.js";

export default async function AgentPortalLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.mustChange) redirect("/change-password");
  if (session.user.role !== "Agent") redirect("/workspace");

  const locale = await getLocale();
  const themeIntent = await getThemeIntent();

  return (
    <div dir={dirFor(locale)} className="mx-auto min-h-screen w-full max-w-5xl px-4 pb-16">
      <header className="flex flex-wrap items-center gap-3 py-6">
        <Logo size={32} subtitle={t(locale, "portal.subtitle")} />
        <span className="flex-1" />
        <GuideButton role="Agent" />
        <Tip label="Switch between English and Arabic" side="bottom">
          <LangToggle locale={locale} />
        </Tip>
        <Tip label="Switch between dark, light and following your system" side="bottom">
          <ThemeToggle initial={themeIntent} />
        </Tip>
        <GlassBadge tone="violet">
          <UserRound size={11} />
          {session.user.name}
        </GlassBadge>
        <SignOutButton />
      </header>
      {children}
    </div>
  );
}

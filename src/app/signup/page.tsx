/* The joining page. Public by necessity — it is the one screen a person uses
   before they have an account.

   Whether sign-up is open is resolved here rather than fetched, so a closed
   deployment renders "not switched on" on the first paint instead of flashing
   a form nobody can use. */

import { getLocale } from "@/lib/locale";
import { dirFor } from "@/lib/i18n.js";
import { signupGate } from "@/lib/signup.js";
import SignupForm from "@/components/SignupForm";
import LangToggle from "@/components/LangToggle";
import ThemeToggle from "@/components/ThemeToggle";
import { getThemeIntent } from "@/lib/theme-server";

export default async function SignupPage() {
  const locale = await getLocale();
  const themeIntent = await getThemeIntent();
  const { open } = signupGate(process.env as Record<string, string | undefined>);

  return (
    <main dir={dirFor(locale)} className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute top-4 right-4 flex items-center gap-2 rtl:right-auto rtl:left-4">
        <ThemeToggle initial={themeIntent} />
        <LangToggle locale={locale} />
      </div>
      <SignupForm open={open} />
    </main>
  );
}

/* Glass login over the aurora. Server component: resolves the locale so the
   form paints in the right language and direction from the first byte, and the
   language toggle rides in the corner. "/" then routes by role after sign-in. */

import { getLocale } from "@/lib/locale";
import { dirFor } from "@/lib/i18n.js";
import LoginForm from "@/components/LoginForm";
import LangToggle from "@/components/LangToggle";
import ThemeToggle from "@/components/ThemeToggle";
import { getThemeIntent } from "@/lib/theme-server";

export default async function LoginPage() {
  const locale = await getLocale();
  const themeIntent = await getThemeIntent();
  return (
    <main dir={dirFor(locale)} className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute top-4 right-4 flex items-center gap-2 rtl:right-auto rtl:left-4">
        <ThemeToggle initial={themeIntent} />
        <LangToggle locale={locale} />
      </div>
      <LoginForm locale={locale} />
    </main>
  );
}

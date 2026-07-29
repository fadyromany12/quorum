"use client";

/* Flips the "locale" cookie between English and Arabic and refreshes so the
   server re-renders with the new language and direction. */

import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { t } from "@/lib/i18n.js";

export default function LangToggle({ locale }: { locale: string }) {
  const router = useRouter();
  const other = locale === "ar" ? "en" : "ar";

  const setLang = () => {
    document.cookie = `locale=${other}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={setLang}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] font-semibold text-slate-300 transition hover:border-violet-400/30 hover:text-slate-100"
      aria-label="Switch language"
    >
      <Languages size={13} />
      {t(locale, "common.lang")}
    </button>
  );
}

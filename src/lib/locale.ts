/* Server-side locale resolution — reads the "locale" cookie set by LangToggle. */

import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALES } from "./i18n.js";

export async function getLocale(): Promise<string> {
  const c = (await cookies()).get("locale")?.value;
  return c && LOCALES.includes(c) ? c : DEFAULT_LOCALE;
}

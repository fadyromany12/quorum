"use client";

/* The reader's language, available anywhere without threading it through
   twenty components.

   Prop drilling would have been the wrong shape here. Locale is not data one
   screen owns and passes down — it is an ambient fact about the person reading,
   like the theme, and every leaf that renders a taxonomy label needs it. A
   `locale` prop on twenty components is twenty chances to forget one, and the
   symptom of forgetting is a single English word in an Arabic screen, which
   nobody files a bug about and everybody notices.

   Deliberately read-only. Changing language is a cookie write and a server
   round trip (LangToggle), because the labels live in server-rendered payloads
   as well as client components — a context that could set locale would update
   half the screen and leave the other half in the previous language. */

import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, labelOf, labelFor, isRtl, dirFor } from "../lib/i18n.js";

const LocaleContext = createContext(DEFAULT_LOCALE);

export function LocaleProvider({ locale = DEFAULT_LOCALE, children }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/** The current locale. Defaults to English outside a provider, so a component
    rendered in isolation (a test, a story) still produces readable output. */
export const useLocale = () => useContext(LocaleContext);

/** The helpers, pre-bound to the current locale — so a call site reads
    `label(LEAVE_TYPES, code)` rather than repeating the locale every time. */
export function useLabels() {
  const locale = useLocale();
  return {
    locale,
    rtl: isRtl(locale),
    dir: dirFor(locale),
    /** One entry: `label(SCHEDULE_ACTIVITIES[a])`. */
    label: (item, fallback) => labelOf(item, locale, fallback),
    /** A code against its map: `labelFor(LEAVE_TYPES, "Casual")`. */
    labelFor: (map, code) => labelFor(map, code, locale),
  };
}

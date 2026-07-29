/* Server-side theme intent — reads the cookie the toggle writes. */

import { cookies } from "next/headers";
import { DEFAULT_THEME, isTheme } from "./theme.js";

export async function getThemeIntent(): Promise<string> {
  const v = (await cookies()).get("theme")?.value;
  return isTheme(v) ? (v as string) : DEFAULT_THEME;
}

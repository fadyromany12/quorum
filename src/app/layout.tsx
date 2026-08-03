import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Space_Grotesk } from "next/font/google";
import { BRAND } from "@/lib/brand";
import { DEFAULT_THEME, isTheme, resolveTheme, NO_FLASH_SCRIPT } from "@/lib/theme.js";
import { DENSITY_SCRIPT } from "@/lib/density.js";
import "./globals.css";

/* Ink & Signal type stack — self-hosted via next/font (no FOUT, no Google
   round-trip): Space Grotesk for display, Geist Sans for UI, Geist Mono for
   data. globals.css maps the .ao-* helper classes onto these variables. */
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: `${BRAND.name} · ${BRAND.org}`,
  description: `${BRAND.name} — ${BRAND.promise}. Records, attendance, approvals, leave, conduct and clearance.`,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Render the stored intent server-side so the markup already carries a
  // theme; the inline script then upgrades "system" to the live OS value
  // before first paint, so there is never a flash of the wrong theme.
  const stored = (await cookies()).get("theme")?.value;
  const intent = isTheme(stored) ? stored! : DEFAULT_THEME;

  return (
    <html lang="en" data-theme={resolveTheme(intent)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `${NO_FLASH_SCRIPT}\n${DENSITY_SCRIPT}` }} />
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable} ${display.variable}`}>{children}</body>
    </html>
  );
}

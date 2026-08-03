/* Server-side density preference — reads the cookie the toggle writes. */

import { cookies } from "next/headers";
import { DEFAULT_DENSITY, isDensity } from "./density.js";

export async function getDensity(): Promise<string> {
  const v = (await cookies()).get("density")?.value;
  return isDensity(v) ? (v as string) : DEFAULT_DENSITY;
}

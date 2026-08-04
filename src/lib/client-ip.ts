/* Who is calling, for throttling only.

   Behind a proxy the socket address is the proxy, so the caller is whatever
   the platform put in a header — and a header is client-supplied unless
   something trustworthy overwrote it. Vercel does overwrite x-forwarded-for,
   which is why it is read first here; on a host that does not, this degrades
   to a value an attacker can rotate, and the throttle degrades with it.

   That is acceptable because nothing is authorised on this value. It narrows a
   rate limit, and the worst a forged one buys is the rate limit that would have
   existed anyway if we keyed on nothing. It must never key a permission. */

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  // Left-most entry is the original client; the rest are proxies it passed.
  const first = xff.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || "unknown";
}

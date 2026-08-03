import { BRAND } from "./brand";
/* Email notifications — fail-open by design.

   Every send is best-effort: a mail provider outage must never fail the
   request that triggered it, so nothing here throws. Without RESEND_API_KEY
   the module logs and reports {skipped: true}, which is also what makes local
   and CI runs quiet. Set the key and it simply starts sending. */

const FROM = process.env.MAIL_FROM || `${BRAND.name} <onboarding@resend.dev>`;

export async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[notify] skipped (no RESEND_API_KEY): ${subject} → ${to}`);
    return { skipped: true as const };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!res.ok) {
      console.error(`[notify] resend ${res.status}: ${await res.text().catch(() => "")}`);
      return { skipped: true as const };
    }
    return { skipped: false as const };
  } catch (err) {
    console.error("[notify] send failed:", err);
    return { skipped: true as const };
  }
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** A short, factual notification. No tracking, no images, states the action. */
export function simpleHtml(title: string, lines: string[], cta?: { label: string; url: string }) {
  return `<div style="font-family:sans-serif;max-width:520px">
    <h2 style="margin:0 0 12px">${esc(title)}</h2>
    ${lines.map((l) => `<p style="margin:6px 0;color:#444">${esc(l)}</p>`).join("")}
    ${cta ? `<p style="margin:18px 0"><a href="${esc(cta.url)}" style="background:#4F46E5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${esc(cta.label)}</a></p>` : ""}
    <p style="font-size:12px;color:#999;margin-top:22px">${BRAND.name} — this is a notification, not a record. The record is in the app.</p>
  </div>`;
}

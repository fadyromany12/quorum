/* GET /api/cases/:id/letter — the formal warning letter as a PDF.

   Available to case-writing staff for any case, and to the agent the case
   belongs to. Only disciplinary cases have a letter. The document is rendered
   from letterModel(), so every figure matches the finalized ledger. */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { toEntry } from "@/lib/db";
import { can } from "@/lib/auth.js";
import { BRAND } from "@/lib/brand";
import { letterModel, letterFilename } from "@/lib/letter.js";
import { fmtDateLong, fmtStamp } from "@/lib/format.js";

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole(null); // any authenticated; finer check below
  const id = new URL(req.url).pathname.split("/").slice(-2)[0]; // .../cases/:id/letter

  const row = await prisma.case.findUnique({ where: { id } });
  if (!row) throw new GuardError(404, "Case not found.");
  if (!row.disciplinary) throw new GuardError(400, "This case is not disciplinary — no warning letter applies.");

  // Access: case-writing staff, or the agent this case belongs to.
  let allowed = can({ role: actor.role }, "caseWrite");
  if (!allowed) {
    const me = await prisma.user.findUnique({ where: { id: actor.id } });
    allowed = Boolean(
      me &&
        ((row.empId && me.empId && row.empId.toLowerCase() === me.empId.toLowerCase()) ||
          (row.email && me.email && row.email.toLowerCase() === me.email.toLowerCase()))
    );
  }
  if (!allowed) throw new GuardError(403, "You may not view this letter.");

  const m = letterModel(toEntry(row) as never, { org: BRAND.org });
  const pdf = await renderLetter(m);

  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${letterFilename(toEntry(row) as never)}"`,
      "cache-control": "no-store",
    },
  });
});

type Model = ReturnType<typeof letterModel>;

async function renderLetter(m: Model): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.11, 0.15);
  const sub = rgb(0.42, 0.46, 0.52);
  const line = rgb(0.8, 0.82, 0.85);

  const M = 56;
  const right = page.getWidth() - M;
  const width = right - M;
  let y = page.getHeight() - M;

  // Helvetica is WinAnsi (CP1252) and throws on anything it can't map (e.g. № or
  // Arabic). Keep Latin-1 and the CP1252 typographic extras (smart quotes,
  // en/em dashes, bullet, ellipsis…); map № to "No."; replace the rest — so an
  // agent's name can never crash the render.
  const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  const safe = (s: unknown) =>
    String(s ?? "")
      .replace(/№/g, "No.")
      .split("")
      .map((ch) => ((ch.codePointAt(0) ?? 0) <= 0xff || CP1252_EXTRA.includes(ch) ? ch : "?"))
      .join("");

  const text = (s: string, x: number, size: number, f = font, color = ink) => page.drawText(safe(s), { x, y, size, font: f, color });
  const wrap = (s: string, f: typeof font, size: number, maxW: number) => {
    const out: string[] = [];
    let cur = "";
    for (const w of safe(s).split(/\s+/)) {
      const t = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > maxW && cur) {
        out.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  };
  const para = (s: string, size = 10.5, gap = 6) => {
    for (const ln of wrap(s, font, size, width)) {
      text(ln, M, size);
      y -= size + 3;
    }
    y -= gap;
  };

  // Letterhead
  text(m.org.toUpperCase(), M, 16, bold);
  text("DCM v1.0", right - font.widthOfTextAtSize("DCM v1.0", 9), 9, font, sub);
  y -= 22;
  text(m.title, M, 13, bold, rgb(0.55, 0.36, 0.96));
  y -= 16;
  page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 1, color: line });
  y -= 20;

  // Meta row
  text(`Reference: ${m.ref}`, M, 9.5, font, sub);
  text(`Issued: ${fmtDateLong(m.issued)}`, right - font.widthOfTextAtSize(`Issued: ${fmtDateLong(m.issued)}`, 9.5), 9.5, font, sub);
  y -= 22;

  // To block
  text("TO", M, 9, bold, sub);
  y -= 14;
  text(m.employee.name, M, 12, bold);
  y -= 15;
  for (const l of [
    `Employee ID: ${m.employee.empId}`,
    `Email: ${m.employee.email}`,
    `Account: ${m.employee.account}   ·   LOB: ${m.employee.lob}`,
  ]) {
    text(l, M, 10, font, sub);
    y -= 13;
  }
  y -= 10;

  // Subject
  text("RE:", M, 10, bold);
  for (const ln of wrap(m.subject, bold, 10, width - 28)) {
    text(ln, M + 28, 10, bold);
    y -= 13;
  }
  y -= 10;

  // Body
  for (const p of m.body) para(p);

  // Signatures
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 0.5, color: line });
  y -= 26;
  const colW = (width - 24) / 2;
  const sigLine = (label: string, x: number) => {
    page.drawLine({ start: { x, y }, end: { x: x + colW, y }, thickness: 0.75, color: ink });
    page.drawText(label, { x, y: y - 12, size: 9, font, color: sub });
  };
  sigLine("Employee signature & date", M);
  sigLine("HR representative & date", M + colW + 24);
  y -= 40;

  if (m.acknowledged) {
    text(
      `Digitally acknowledged by the employee on ${fmtStamp(m.acknowledged.at)} — signed "${m.acknowledged.signature}".`,
      M,
      9,
      font,
      rgb(0.2, 0.5, 0.35)
    );
    y -= 16;
  }

  // Footer
  y = M - 8;
  for (const ln of wrap(`${m.lawCitation}. This notice is a system-of-record document generated by ${m.org} Quorum.`, font, 8, width)) {
    text(ln, M, 8, font, sub);
    y -= 10;
  }

  return doc.save();
}

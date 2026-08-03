/* GET /api/payslips/pdf?employeeId=&period=YYYY-MM — the payslip as a PDF.

   Generated, never stored. The records are the truth and the same records
   produce the same document, so storing a rendered copy would only create a
   second thing that can disagree with the first — and the stored one always
   wins an argument it should not.

   A payslip that does not add up is never rendered. checkPayslip runs first and
   a failure is a 409 naming the reason, because an official-looking document
   with a wrong total is worse in every way than an error message: it gets filed,
   forwarded to a bank, and produced in a dispute. */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { NextResponse } from "next/server";
import { guarded, GuardError } from "@/lib/api-guard";
import { winAnsiLine as safe } from "@/lib/pdf-text.js";
import { BRAND } from "@/lib/brand";
import { todayStr } from "@/lib/dates.js";

/** The JSON endpoint is the single assembler; this only draws it. Two routes
    computing a payslip independently is two payslips waiting to differ. */
async function fetchSlip(req: Request, employeeId: string, period: string) {
  const url = new URL(req.url);
  url.pathname = "/api/payslips";
  url.search = new URLSearchParams({ ...(employeeId ? { employeeId } : {}), period }).toString();
  const res = await fetch(url, { headers: { cookie: req.headers.get("cookie") ?? "" } });
  const body = await res.json();
  if (!res.ok) throw new GuardError(res.status, body.error ?? "Could not build the payslip.");
  return body;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1] ?? period} ${y}`;
};

export const GET = guarded(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const period = q.get("period") ?? "";
  if (!/^\d{4}-\d{2}$/.test(period)) throw new GuardError(400, "A period (YYYY-MM) is required.");

  const slip = await fetchSlip(req, q.get("employeeId") ?? "", period);
  if (!slip.issuable) {
    throw new GuardError(409, `This payslip cannot be issued: ${(slip.problems ?? []).join(" ")}`);
  }

  const e = slip.employee;
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.16);
  const soft = rgb(0.42, 0.46, 0.53);

  let y = 792;
  const text = (t: string, x: number, opts: { b?: boolean; size?: number; color?: typeof ink } = {}) =>
    page.drawText(safe(t), { x, y, size: opts.size ?? 10, font: opts.b ? bold : font, color: opts.color ?? ink });
  const row = (label: string, value: string, opts: { b?: boolean; size?: number; color?: typeof ink } = {}) => {
    text(label, 60, opts);
    const s = safe(value);
    const size = opts.size ?? 10;
    const f = opts.b ? bold : font;
    // Right-aligned: a column of money that does not line up is a column
    // nobody can add up by eye, which is the only check most people do.
    page.drawText(s, { x: 535 - f.widthOfTextAtSize(s, size), y, size, font: f, color: opts.color ?? ink });
    y -= 16;
  };
  const rule = (gap = 10) => {
    page.drawLine({ start: { x: 60, y: y + 4 }, end: { x: 535, y: y + 4 }, thickness: 0.6, color: rgb(0.85, 0.87, 0.9) });
    y -= gap;
  };

  text(`${BRAND.org} — Payslip`, 60, { b: true, size: 15 });
  y -= 20;
  text(monthName(period), 60, { size: 11, color: soft });
  y -= 26;

  text(e.fullNameEn, 60, { b: true, size: 11 });
  y -= 15;
  text(`${e.empId}${e.jobTitle ? ` · ${e.jobTitle}` : ""}${e.account ? ` · ${e.account}` : ""}`, 60, { size: 9.5, color: soft });
  y -= 24;

  text("Earnings", 60, { b: true, size: 10.5 });
  y -= 16;
  rule();
  for (const l of slip.earnings ?? []) {
    row(l.label, `${slip.currency} ${l.display}`);
    if (l.how) { text(l.how, 72, { size: 8, color: soft }); y -= 13; }
  }
  rule();
  row("Gross pay", `${slip.currency} ${slip.grossDisplay}`, { b: true });
  y -= 12;

  text("Deductions", 60, { b: true, size: 10.5 });
  y -= 16;
  rule();
  if ((slip.deductions ?? []).length === 0) {
    text("None this period.", 60, { size: 9.5, color: soft });
    y -= 16;
  }
  for (const l of slip.deductions ?? []) {
    row(l.label, `− ${slip.currency} ${l.display}`);
    if (l.how) { text(l.how, 72, { size: 8, color: soft }); y -= 13; }
  }
  rule();
  row("Total deductions", `− ${slip.currency} ${slip.totalDeductions}`, { b: true });
  y -= 14;

  rule(14);
  row("Net pay", `${slip.currency} ${slip.netDisplay}`, { b: true, size: 13 });
  y -= 12;

  /* The notes are the honest part of the document. An unconfigured tax rate
     means this is not a final net figure, and the person holding the paper
     needs to know that from the paper. */
  for (const n of slip.notes ?? []) {
    text(n, 60, { size: 8.5, color: soft });
    y -= 12;
  }

  y -= 8;
  text(`Issued ${todayStr()}. Generated from ${BRAND.name} records and valid without a signature.`, 60, { size: 8, color: soft });
  y -= 11;
  text(`Rates: daily ${slip.currency} ${(Number(slip.dailyRateMinor) / 100).toFixed(2)} · hourly ${slip.currency} ${(Number(slip.hourlyRateMinor) / 100).toFixed(2)} (30-day month, 8-hour day).`, 60, { size: 8, color: soft });

  const bytes = await doc.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="payslip-${e.empId}-${period}.pdf"`,
    },
  });
});

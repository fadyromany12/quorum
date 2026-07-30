/* GET /api/letters/[id] — render an approved HR letter as a PDF.

   The letter is generated, never stored: the request row is the record, and a
   regenerated PDF from the same row is the same letter. Only the subject or HR
   may download, and only once the request is approved — an unapproved letter
   does not exist, it is merely asked for. */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { statusOf } from "@/lib/workflow.js";
import { toRequest } from "@/lib/workflow-db";
import { toMinor, formatMinor } from "@/lib/comp.js";
import { todayStr } from "@/lib/dates.js";
// Helvetica is WinAnsi; the projection and the reasons for it live in pdf-text.
import { winAnsiLine as safe } from "@/lib/pdf-text.js";

const KINDS: Record<string, string> = {
  bank: "Bank letter",
  employment: "Employment letter",
  salary: "Salary certificate",
};

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const id = new URL(req.url).pathname.split("/").filter(Boolean).pop() as string;

  const row = await prisma.request.findUnique({
    where: { id },
    include: { steps: true, subject: true },
  });
  if (!row || row.type !== "letterRequest") throw new GuardError(404, "No such letter.");

  const me = await prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
  const isHr = ["SuperAdmin", "HRBusinessPartner"].includes(actor.role);
  if (!isHr && me?.id !== row.subjectId) throw new GuardError(404, "No such letter.");

  const status = statusOf(toRequest(row as never) as never);
  if (status !== "approved") {
    throw new GuardError(409, `This letter is ${status} — it can be downloaded once HR approves it.`);
  }

  const e = row.subject;
  const kind = String((row.payload as { kind?: string })?.kind ?? "employment");
  const latestPay = kind === "salary"
    ? await prisma.compensationRecord.findFirst({
        where: { employeeId: e.id, voided: false },
        orderBy: [{ effectiveFrom: "desc" }, { recordedAt: "desc" }],
      })
    : null;

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 780;
  const line = (t: string, opts: { b?: boolean; size?: number; gap?: number } = {}) => {
    page.drawText(safe(t), { x: 60, y, size: opts.size ?? 11, font: opts.b ? bold : font, color: rgb(0.1, 0.1, 0.16) });
    y -= opts.gap ?? 18;
  };

  line("Konecta GDC — Human Resources", { b: true, size: 14, gap: 26 });
  line(`Date: ${todayStr()}`, { gap: 26 });
  line(KINDS[kind] ?? "HR letter", { b: true, size: 12, gap: 24 });
  line("To whom it may concern,", { gap: 22 });
  line(`This is to certify that ${e.fullNameEn} (ID ${e.empId}) is employed by`);
  line(`Konecta GDC as ${e.jobTitle || "an employee"}${e.account ? ` on the ${e.account} account` : ""},`);
  line(`${e.hireDate ? `since ${e.hireDate}` : "on an active basis"}. Their employment status is ${e.stage}.`, { gap: 22 });
  if (kind === "salary") {
    // Decimal → minor units → grouped string, through the money helpers rather
    // than by multiplying a float, for the reason comp.js exists.
    const minor = latestPay ? toMinor(String(latestPay.baseSalary)) : null;
    line(
      minor === null
        ? "Their salary details are on file with Human Resources."
        : `Their current base salary is EGP ${formatMinor(minor)} per month.`,
      { gap: 22 },
    );
  }
  if (kind === "bank") {
    line("This letter is issued at the employee's request for presentation to their bank.", { gap: 22 });
  }
  line("This letter was issued electronically and is valid without a signature.", { gap: 30 });
  line("Human Resources", { b: true });
  line(`Ref: ${row.id}`, { size: 9 });

  const bytes = await doc.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${kind}-letter-${e.empId}.pdf"`,
    },
  });
});

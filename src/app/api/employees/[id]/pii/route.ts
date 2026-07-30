/* GET /api/employees/[id]/pii — government identifiers, banking, next of kin.
   PUT /api/employees/[id]/pii — write the same.

   Its own endpoint, its own permission, and every read writes an audit row
   before the data is returned. That is the point: an unaudited PII read is
   indistinguishable from exfiltration after the fact, and in the Apps Script
   prototype `getEmployeeData(email)` would hand any caller a National ID,
   passport number and IBAN with no check and no trace. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { readPii } from "@/lib/employee-db";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";

const idFrom = (req: Request) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2]; // .../employees/<id>/pii
};

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("piiRead");
  const result = await readPii(idFrom(req), actor);
  if (!result) throw new GuardError(404, "No such employee.");
  // pii may legitimately be null — an applicant who has not submitted it yet.
  return NextResponse.json({ employee: result.employee, pii: result.pii });
});

/* Written as a whole record rather than patched field-by-field: these values
   arrive together off one form, and a partial write leaves a bank account
   half-updated, which is worse than rejecting the request. */
const FIELDS = [
  "nationalId", "passportNumber", "socialInsuranceNo",
  "bankName", "swiftCode", "accountNumber", "iban",
  "maritalStatus", "marriageDate",
  "emergencyName", "emergencyPhone", "emergencyRelation",
  "photoUrl", "nationalIdScanUrl", "offerLetterUrl", "marriageCertUrl",
] as const;

// Egyptian National ID: exactly 14 digits. Validated because a malformed one
// silently breaks social-insurance filing months later.
const NID_RE = /^\d{14}$/;

export const PUT = guarded(async (req: Request) => {
  const actor = await requireRole("piiWrite");
  const id = idFrom(req);
  const body = await req.json().catch(() => ({}));

  const employee = await prisma.employee.findUnique({
    where: { id },
    select: { id: true, empId: true, fullNameEn: true },
  });
  if (!employee) throw new GuardError(404, "No such employee.");

  const nationalId = String(body.nationalId ?? "").trim();
  if (nationalId && !NID_RE.test(nationalId)) {
    throw new GuardError(400, "An Egyptian National ID is exactly 14 digits.");
  }

  const data: Record<string, string> = {};
  for (const f of FIELDS) data[f] = String(body[f] ?? "").trim();

  const pii = await prisma.employeePII.upsert({
    where: { employeeId: id },
    create: { employeeId: id, ...data },
    update: data,
  });

  /* The summary names which fields were supplied, never their values — an audit
     log that quotes an IBAN has just become a second copy of the data. */
  const supplied = FIELDS.filter((f) => data[f] !== "");
  await writeAudit({
    actor,
    action: "PII_UPDATED",
    summary: `Updated identifiers for ${employee.fullNameEn} (${employee.empId}): ${supplied.length} field(s) set.`,
    meta: { employeeId: id, fields: supplied },
  });

  return NextResponse.json({ pii });
});

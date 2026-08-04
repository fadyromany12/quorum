/* GET    /api/employees/[id]/documents — the file, and what is wrong with it.
   POST   /api/employees/[id]/documents — record one, or verify one.
   DELETE /api/employees/[id]/documents?docId= — void one.

   Two access levels, because the file is not one thing. Anyone who may see the
   employee may see that a contract exists and when it lapses — that is the
   compliance question and a lead needs it. Only piiRead sees where an identity
   document actually lives, because that pointer is the thing that leads to a
   scan of somebody's national ID.

   Deleting is voiding. "We never had it" and "we had it and somebody removed
   it" are different answers to an auditor, and only one of them is recoverable. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { assertVisibleEmployee } from "@/lib/employee-db";
import { writeAudit } from "@/lib/db";
import { can } from "@/lib/auth.js";
import { checkDocument, fileState, isSensitive, isDocKind, DOC_KINDS } from "@/lib/documents.js";
import { todayStr } from "@/lib/dates.js";

const idFrom = (req: Request) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  return parts[parts.indexOf("employees") + 1] ?? "";
};

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("employeeRead");
  const employeeId = idFrom(req);
  await assertVisibleEmployee(actor, employeeId);

  const seesPointers = can(actor, "piiRead");
  const rows = await prisma.employeeDocument.findMany({
    where: { employeeId },
    orderBy: [{ voided: "asc" }, { expiresOn: "desc" }, { createdAt: "desc" }],
  });

  /* The compliance view is not the sensitive view. Stripping the pointer rather
     than the row means a lead can still see that a work permit expires in
     March — which is the thing they need to act on — without being handed the
     location of a passport scan. */
  const docs = rows.map((d) => ({
    ...d,
    location: seesPointers || !isSensitive(d.kind) ? d.location : "",
    locationHidden: !seesPointers && isSensitive(d.kind),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    verifiedAt: d.verifiedAt?.toISOString() ?? null,
  }));

  return NextResponse.json({
    documents: docs,
    state: fileState(rows, { today: todayStr() }),
    kinds: DOC_KINDS,
    canWrite: can(actor, "employeeWrite"),
    seesPointers,
  });
});

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole("employeeWrite");
  const employeeId = idFrom(req);
  await assertVisibleEmployee(actor, employeeId);
  const body = await req.json().catch(() => ({}));

  /* Verifying is its own action rather than a field on the create, because it
     is a different claim: recording says "this exists", verifying says "I have
     seen the original and it is real". Somebody has to be able to say who. */
  if (body.action === "verify") {
    const docId = String(body.docId ?? "");
    const doc = await prisma.employeeDocument.findUnique({ where: { id: docId }, select: { employeeId: true, kind: true } });
    if (!doc || doc.employeeId !== employeeId) throw new GuardError(404, "No such document.");

    await prisma.employeeDocument.update({
      where: { id: docId },
      data: { verifiedAt: new Date(), verifiedById: actor.id, verifiedByName: actor.name },
    });
    await writeAudit({
      actor,
      action: "DOCUMENT_VERIFIED",
      summary: `Verified ${DOC_KINDS[doc.kind as keyof typeof DOC_KINDS]?.label ?? doc.kind} against the original.`,
      meta: { employeeId, docId, kind: doc.kind },
    });
    return NextResponse.json({ ok: true });
  }

  const payload = {
    kind: String(body.kind ?? ""),
    location: String(body.location ?? "").trim(),
    title: String(body.title ?? "").trim(),
    note: String(body.note ?? "").trim(),
    issuedOn: String(body.issuedOn ?? ""),
    expiresOn: String(body.expiresOn ?? ""),
  };
  const { problems } = checkDocument(payload, { today: todayStr() });
  if (problems.length) throw new GuardError(400, problems[0]);
  if (!isDocKind(payload.kind)) throw new GuardError(400, "Unknown document kind.");

  const created = await prisma.employeeDocument.create({
    data: { ...payload, employeeId, actorName: actor.name, actorRole: actor.role },
    select: { id: true },
  });

  /* Audited without the pointer. An audit row that repeats the location of a
     passport scan turns the audit trail into a second copy of the thing the
     pointer was protecting. */
  await writeAudit({
    actor,
    action: "DOCUMENT_ADDED",
    summary: `Recorded ${DOC_KINDS[payload.kind as keyof typeof DOC_KINDS]?.label ?? payload.kind}${payload.expiresOn ? `, expires ${payload.expiresOn}` : ""}.`,
    meta: { employeeId, docId: created.id, kind: payload.kind, expiresOn: payload.expiresOn },
  });

  return NextResponse.json({ ok: true, id: created.id });
});

export const DELETE = guarded(async (req: Request) => {
  const actor = await requireRole("employeeWrite");
  const employeeId = idFrom(req);
  await assertVisibleEmployee(actor, employeeId);

  const url = new URL(req.url);
  const docId = url.searchParams.get("docId") ?? "";
  const reason = (url.searchParams.get("reason") ?? "").trim();
  if (!reason) throw new GuardError(400, "Say why it is being removed — the row is kept either way.");

  const doc = await prisma.employeeDocument.findUnique({ where: { id: docId }, select: { employeeId: true, kind: true } });
  if (!doc || doc.employeeId !== employeeId) throw new GuardError(404, "No such document.");

  await prisma.employeeDocument.update({ where: { id: docId }, data: { voided: true, voidReason: reason } });
  await writeAudit({
    actor,
    action: "DOCUMENT_VOIDED",
    summary: `Removed ${DOC_KINDS[doc.kind as keyof typeof DOC_KINDS]?.label ?? doc.kind} from the file: ${reason}`,
    meta: { employeeId, docId, kind: doc.kind },
  });

  return NextResponse.json({ ok: true });
});

/* GET  /api/assets?employeeId= — what somebody has, or everything still out.
   POST /api/assets — issue one, or close one off.

   Reading is scoped the way the directory is: a lead sees their own people.
   Writing needs employeeWrite, because issuing a laptop is a claim about
   company property that has a cost attached when it goes wrong. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { assertVisibleEmployee, visibilityScope } from "@/lib/employee-db";
import { writeAudit } from "@/lib/db";
import { can } from "@/lib/auth.js";
import { checkIssue, checkReturn, outstanding, clearanceState, ASSET_KINDS, isAssetKind, isAssetState } from "@/lib/assets.js";
import { todayStr } from "@/lib/dates.js";

const labelOf = (kind: string) => (ASSET_KINDS as Record<string, { label?: string }>)[kind]?.label ?? kind;

export const GET = guarded(async (req: Request) => {
  const actor = await requireRole("employeeRead");
  const employeeId = new URL(req.url).searchParams.get("employeeId") ?? "";

  if (employeeId) {
    await assertVisibleEmployee(actor, employeeId);
    const rows = await prisma.asset.findMany({
      where: { holderId: employeeId },
      orderBy: [{ state: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({
      assets: rows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() })),
      outstanding: outstanding(rows),
      clearance: clearanceState(rows),
      kinds: ASSET_KINDS,
      canWrite: can(actor, "employeeWrite"),
    });
  }

  /* Everything still out, for the people this actor can see. The register's
     other use: not "what does this person have" but "what have we not got
     back", which is the question nobody could ask before. */
  const scope = await visibilityScope(actor);
  const rows = await prisma.asset.findMany({
    where: { state: "issued", ...(scope ? { holderId: { in: scope } } : {}) },
    include: { holder: { select: { id: true, fullNameEn: true, preferredName: true, stage: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return NextResponse.json({
    assets: rows.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      holderName: a.holder ? a.holder.preferredName || a.holder.fullNameEn : "unassigned",
      /* The rows that matter most: kit still out with somebody who has left. */
      holderLeft: a.holder?.stage === "Exited",
    })),
    outstanding: outstanding(rows),
    kinds: ASSET_KINDS,
    canWrite: can(actor, "employeeWrite"),
  });
});

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole("employeeWrite");
  const body = await req.json().catch(() => ({}));

  if (body.action === "close") {
    const id = String(body.id ?? "");
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new GuardError(404, "No such item.");
    if (asset.holderId) await assertVisibleEmployee(actor, asset.holderId);

    const state = String(body.state ?? "");
    const note = String(body.note ?? "").trim();
    const { problems } = checkReturn(asset, { state, note, returnedOn: body.returnedOn });
    if (problems.length) throw new GuardError(400, problems[0]);
    if (!isAssetState(state)) throw new GuardError(400, "Unknown state.");

    await prisma.asset.update({
      where: { id },
      data: {
        state,
        returnedOn: String(body.returnedOn ?? todayStr()),
        condition: String(body.condition ?? "").trim(),
        note,
        /* The holder is deliberately NOT cleared. An asset that disappears
           from somebody's record the moment it is closed makes "what happened
           to their laptop" unanswerable at exactly the point it is asked, and
           the whole reason this is a table is that nothing is ever deleted.
           "Still out" is `state: issued`, which the register already filters on. */
        actorName: actor.name,
        actorRole: actor.role,
      },
    });

    await writeAudit({
      actor,
      action: state === "returned" ? "ASSET_RETURNED" : "ASSET_CLOSED",
      summary: `${labelOf(asset.kind)}${asset.serial ? ` (${asset.serial})` : ""} — ${state}.${note ? ` ${note}` : ""}`,
      meta: { assetId: id, employeeId: asset.holderId, kind: asset.kind, state, replacementCostMinor: asset.replacementCostMinor },
    });
    return NextResponse.json({ ok: true });
  }

  const holderId = String(body.holderId ?? "");
  if (holderId) await assertVisibleEmployee(actor, holderId);

  const serial = String(body.serial ?? "").trim();
  const kind = String(body.kind ?? "");
  /* Checked against what is *out*, not against every row ever — the same serial
     legitimately reappears when a returned laptop is reissued. */
  const taken = serial
    ? Boolean(await prisma.asset.findFirst({ where: { kind, serial, state: "issued" }, select: { id: true } }))
    : false;

  const payload = {
    kind,
    holderId,
    serial,
    label: String(body.label ?? "").trim(),
    replacementCostMinor: Number(body.replacementCostMinor ?? 0),
    issuedOn: String(body.issuedOn ?? todayStr()),
    note: String(body.note ?? "").trim(),
  };
  const { problems } = checkIssue(payload, { serialTaken: taken });
  if (problems.length) throw new GuardError(400, problems[0]);
  if (!isAssetKind(kind)) throw new GuardError(400, "Unknown asset kind.");

  const created = await prisma.asset.create({
    data: { ...payload, state: "issued", actorName: actor.name, actorRole: actor.role },
    select: { id: true },
  });

  await writeAudit({
    actor,
    action: "ASSET_ISSUED",
    summary: `Issued ${labelOf(kind)}${serial ? ` (${serial})` : ""}.`,
    meta: { assetId: created.id, employeeId: holderId, kind, serial },
  });

  return NextResponse.json({ ok: true, id: created.id });
});

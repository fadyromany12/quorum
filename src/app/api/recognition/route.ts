/* GET  /api/recognition — the wall, and mine.
   POST /api/recognition — thank somebody.

   Open to anyone with an employment record, because the whole point is that an
   agent can thank another agent. Gating it on a role would leave the only
   positive thing in the product available exclusively to the people who already
   have every other button. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { checkRecognition, summarise, isRecognitionValue, isVisibility, RECOGNITION_VALUES, VISIBILITIES } from "@/lib/recognition.js";
import { notifyEmployee } from "@/lib/push-db";
import { todayStr } from "@/lib/dates.js";

const NO_RECORD = "Your login is not linked to an employment record yet — HR can link it.";

const SELECT = {
  id: true, value: true, note: true, visibility: true, createdAt: true, toId: true, fromId: true,
  to: { select: { id: true, fullNameEn: true, preferredName: true, account: true } },
  from: { select: { id: true, fullNameEn: true, preferredName: true } },
};

export const GET = guarded(async () => {
  const actor = await requireRole(null);
  const me = await prisma.employee.findUnique({
    where: { userId: actor.id },
    select: { id: true, account: true, directManagerId: true },
  });
  if (!me) throw new GuardError(409, NO_RECORD);

  /* The wall is the team's, not the company's. A company-wide feed from a
     three-account BPO is a stream of names nobody recognises, which is how a
     wall becomes wallpaper. Private ones are visible only to the two people
     involved and the receiver's manager. */
  const [wall, mine] = await Promise.all([
    prisma.recognition.findMany({
      where: {
        visibility: "team",
        ...(me.account ? { to: { account: me.account } } : {}),
      },
      select: SELECT,
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.recognition.findMany({
      where: { OR: [{ toId: me.id }, { fromId: me.id }] },
      select: SELECT,
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const shape = (r: (typeof wall)[number]) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    toName: r.to.preferredName || r.to.fullNameEn,
    fromName: r.from.preferredName || r.from.fullNameEn,
  });

  return NextResponse.json({
    wall: wall.map(shape),
    mine: mine.map(shape),
    received: summarise(mine.filter((r) => r.toId === me.id)),
    values: RECOGNITION_VALUES,
    visibilities: VISIBILITIES,
    me: me.id,
  });
});

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole(null);
  const me = await prisma.employee.findUnique({ where: { userId: actor.id }, select: { id: true } });
  if (!me) throw new GuardError(409, NO_RECORD);

  const body = await req.json().catch(() => ({}));
  const toId = String(body.toId ?? "");
  const value = String(body.value ?? "");
  const note = String(body.note ?? "").trim();
  const visibility = String(body.visibility ?? "team");

  /* Counted server-side rather than trusted from the client, which is the
     whole point of having a limit. */
  const since = new Date(`${todayStr()}T00:00:00.000Z`);
  const [sentToday, recentToSame] = await Promise.all([
    prisma.recognition.count({ where: { fromId: me.id, createdAt: { gte: since } } }),
    prisma.recognition.count({
      where: { fromId: me.id, toId, createdAt: { gte: new Date(Date.now() - 14 * 86400000) } },
    }),
  ]);

  const { problems } = checkRecognition({ toId, value, note, visibility }, { fromId: me.id, sentToday, recentToSame });
  if (problems.length) throw new GuardError(400, problems[0]);
  if (!isRecognitionValue(value) || !isVisibility(visibility)) throw new GuardError(400, "Unknown value or visibility.");

  const target = await prisma.employee.findUnique({
    where: { id: toId },
    select: { id: true, stage: true, fullNameEn: true },
  });
  if (!target) throw new GuardError(404, "No such person.");
  if (target.stage === "Exited") throw new GuardError(409, "They have left.");

  await prisma.recognition.create({ data: { toId, fromId: me.id, value, note, visibility } });

  /* The one notification in this app somebody will be glad to get. Not a
     required kind — it is the sort of thing a person should be able to switch
     off without consequence, unlike an approval. */
  await notifyEmployee(toId, "requestDecided", {
    id: `rec-${toId}`,
    decision: "approved",
    summary: `${actor.name} thanked you: ${note.slice(0, 90)}`,
    url: "/agent-portal",
  });

  return NextResponse.json({ ok: true });
});

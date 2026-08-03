/* POST /api/wfm/forecast — import or correct a day's demand forecast.
   DELETE ?account=&lob=&date= — clear one day.

   Idempotent by construction. The unique key is (account, lob, date, interval),
   so re-importing a day updates in place rather than doubling its volume —
   the failure mode that makes a planner stop trusting an import and go back to
   the spreadsheet. Pasting the same file twice is a no-op, which is what
   someone who is not sure whether the first paste worked will do.

   The whole day is validated before anything is written. A half-imported
   forecast is worse than a rejected one: it produces a requirement that looks
   plausible and is short by however many rows failed. */

import { NextResponse } from "next/server";
import { requireRole, guarded, GuardError } from "@/lib/api-guard";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/db";
import { checkForecast, intervalOf, INTERVAL_MINUTES, DEFAULT_INTERVAL } from "@/lib/wfm.js";

type Row = { interval?: string; contacts?: number; ahtSeconds?: number };

/** Rows that would land outside the interval grid — a 09:07 row in a 30-minute
    plan joins to nothing and would silently vanish from every comparison. */
function offGrid(rows: Row[], width: number) {
  return rows
    .filter((r) => {
      const i = intervalOf(r.interval ?? "", width);
      if (!Number.isFinite(i)) return true;
      const [h, m] = String(r.interval).split(":").map(Number);
      return (h * 60 + m) % width !== 0;
    })
    .map((r) => `${r.interval} is not the start of a ${width}-minute interval.`);
}

export const POST = guarded(async (req: Request) => {
  const actor = await requireRole("wfmWrite");
  const body = (await req.json()) as {
    account?: string; lob?: string; date?: string; source?: string;
    intervalMinutes?: number; rows?: Row[];
  };

  const account = String(body.account ?? "").trim();
  const lob = String(body.lob ?? "").trim();
  const date = String(body.date ?? "").trim();
  if (!account) throw new GuardError(400, "An account is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GuardError(400, "A date (YYYY-MM-DD) is required.");

  const width = INTERVAL_MINUTES.includes(Number(body.intervalMinutes))
    ? Number(body.intervalMinutes)
    : DEFAULT_INTERVAL;
  const rows = Array.isArray(body.rows) ? body.rows : [];

  const problems = [...checkForecast(rows), ...offGrid(rows, width)];
  if (problems.length) throw new GuardError(400, problems.slice(0, 5).join(" "));

  const source = ["client", "historical", "manual"].includes(String(body.source)) ? String(body.source) : "manual";

  /* One transaction: either the day is replaced or it is untouched. Upsert
     rather than delete-then-insert so a row's created-at survives a correction,
     and so a concurrent read never sees the day empty. */
  const written = await prisma.$transaction(
    rows.map((r) =>
      prisma.forecast.upsert({
        where: {
          account_lob_date_interval: { account, lob, date, interval: String(r.interval) },
        },
        create: {
          account, lob, date,
          interval: String(r.interval),
          contacts: Math.round(Number(r.contacts)),
          ahtSeconds: Math.round(Number(r.ahtSeconds)),
          source, actorName: actor.name, actorRole: actor.role,
        },
        update: {
          contacts: Math.round(Number(r.contacts)),
          ahtSeconds: Math.round(Number(r.ahtSeconds)),
          source, actorName: actor.name, actorRole: actor.role,
        },
      })
    )
  );

  await writeAudit({
    actor,
    action: "FORECAST_IMPORTED",
    summary: `Forecast for ${account}${lob ? ` · ${lob}` : ""} on ${date}: ${written.length} intervals`,
    meta: {
      account, lob, date, intervals: written.length, source,
      contacts: written.reduce((s, r) => s + r.contacts, 0),
    },
  });

  return NextResponse.json({ ok: true, written: written.length });
});

export const DELETE = guarded(async (req: Request) => {
  const actor = await requireRole("wfmWrite");
  const q = new URL(req.url).searchParams;
  const account = q.get("account") ?? "";
  const lob = q.get("lob") ?? "";
  const date = q.get("date") ?? "";
  if (!account || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GuardError(400, "An account and a date are required.");

  const { count } = await prisma.forecast.deleteMany({ where: { account, lob, date } });
  await writeAudit({
    actor,
    action: "FORECAST_CLEARED",
    summary: `Cleared the forecast for ${account}${lob ? ` · ${lob}` : ""} on ${date} (${count} intervals)`,
    meta: { account, lob, date, intervals: count },
  });
  return NextResponse.json({ ok: true, deleted: count });
});

"use client";

/* My training, and whether I can take contacts.

   The rules and HR's screen already existed. What was missing was the
   direction: readiness was computed *about* an agent and shown to everybody
   except them. Somebody whose client certification lapses next month finds out
   when they are pulled off the account, and the app knew for six weeks.

   Readiness leads, because it is the consequence. "Refresher expires in 12
   days" means nothing on its own; "you cannot take contacts once this lapses"
   is the sentence that makes somebody book the course. */

import { useCallback, useEffect, useState } from "react";
import { GraduationCap, CircleCheck, TriangleAlert, Clock } from "lucide-react";
import { Card, Muted, Pill } from "../ui/index.jsx";
import { P, alpha } from "../../lib/tokens.js";

const TONE = { valid: P.green, expiring: P.amber, lapsed: P.brick, incomplete: P.sub };

export default function MyTraining() {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/me/training");
    const j = await res.json().catch(() => ({}));
    if (res.ok) setData(j);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) {
    return (
      <Card title={<span className="inline-flex items-center gap-2"><GraduationCap size={14} />My training</span>}>
        <Muted>Loading…</Muted>
      </Card>
    );
  }

  const { records, readiness: r, types } = data;
  const label = (code) => types[code]?.label ?? code;

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><GraduationCap size={14} />My training</span>}
      right={
        r.ready
          ? <Pill color={P.green} filled><CircleCheck size={11} />Ready for contacts</Pill>
          : <Pill color={P.brick} filled><TriangleAlert size={11} />Not ready</Pill>
      }
    >
      {/* The consequence, not the date. */}
      {!r.ready && (
        <div className="p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 9, fontSize: 13 }}>
          <strong>You cannot be put on live contacts until this is sorted.</strong>
          <div style={{ color: P.inkSoft, marginTop: 2 }}>{r.reason}</div>
          {/* Three ways a requirement goes unmet, and they are not synonyms —
              one is a booking, one is finishing, one is a renewal. */}
          {r.missing.length > 0 && <div style={{ marginTop: 4 }}>Never booked: {r.missing.map(label).join(", ")}</div>}
          {r.incomplete.length > 0 && <div>Started but not finished: {r.incomplete.map(label).join(", ")}</div>}
          {r.lapsed.length > 0 && <div>Expired and needs redoing: {r.lapsed.map(label).join(", ")}</div>}
        </div>
      )}

      {records.length === 0 ? (
        <Muted>Nothing recorded yet. Your lead or HR records training as you complete it.</Muted>
      ) : (
        <div className="mt-3 grid gap-1.5">
          {records.map((t) => (
            <div
              key={t.id}
              className="flex flex-wrap items-center gap-2 p-2"
              style={{ border: `1px solid ${alpha(P.ink, 0.1)}`, borderRadius: 8, fontSize: 12.5 }}
            >
              <span style={{ fontWeight: 600 }}>{t.label}</span>
              {t.title && <span style={{ color: P.sub }}>{t.title}</span>}
              <Pill color={TONE[t.status] ?? P.sub} filled={t.status === "lapsed"}>
                {t.status === "valid" ? <CircleCheck size={10} /> : t.status === "lapsed" ? <TriangleAlert size={10} /> : <Clock size={10} />}
                {t.status}
              </Pill>
              <span className="flex-1" />
              {t.completedOn && <span className="ao-mono" style={{ color: P.sub }}>done {t.completedOn}</span>}
              {t.expiresOn && (
                <span className="ao-mono" style={{ color: t.status === "lapsed" ? P.brick : P.sub }}>
                  {t.status === "lapsed" ? "expired" : "valid to"} {t.expiresOn}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <Muted>
        Expiry dates are worked out from when you completed each course, so a change to how long a certificate
        lasts applies to everything rather than only to what was recorded afterwards.
      </Muted>
    </Card>
  );
}

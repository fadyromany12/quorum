"use client";

/* Who is here, who is on, who is away.

   The employee directory already answers "tell me about this person". This
   answers the question people actually open a directory for on a working day:
   can I reach this person right now, and if not, when.

   Deliberately thin on the record. No salary, no identifiers, no case history —
   a directory carrying those is an employee record with a friendlier name, and
   it would need the same permission the employee record has, which would put it
   out of reach of the people who need a phone number. That thinness is what
   lets an agent open it at all.

   Sorted with the people who are actually on shift first, because "who can I
   ask right now" is the question, and an alphabetical list makes you read all
   of it to answer that. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contact, Search, Radio, Plane, Clock } from "lucide-react";
import { Card, Muted, Pill, TInput, TSelect } from "./ui/index.jsx";
import { P, alpha } from "../lib/tokens.js";
import { endTime } from "../lib/myschedule.js";

export default function PeopleFinder() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/directory?q=${encodeURIComponent(q)}&account=${encodeURIComponent(account)}`);
    const j = await res.json().catch(() => ({}));
    if (res.ok) setData(j);
  }, [q, account]);

  /* Debounced, because this searches on every keystroke and the query hits
     four tables. */
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const people = useMemo(() => {
    const rows = data?.people ?? [];
    /* On now, then rostered today, then everybody else. Away last: they are the
       answer to "why can I not reach them", not to "who can I ask". */
    const rank = (p) => (p.loggedIn ? 0 : p.shift && !p.onLeaveToday ? 1 : p.onLeaveToday ? 3 : 2);
    return [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [data]);

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><Contact size={14} />People</span>}
      right={data ? <Pill color={P.sub}>{people.length}</Pill> : null}
    >
      <Muted>Work contact details, who is on shift now, and who is away this week.</Muted>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Search size={14} style={{ color: P.sub, flexShrink: 0 }} />
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <TInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, job title or employee id" />
        </div>
        {(data?.accounts ?? []).length > 1 && (
          <TSelect value={account} onChange={(e) => setAccount(e.target.value)} style={{ width: 150 }}>
            <option value="">All accounts</option>
            {data.accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </TSelect>
        )}
      </div>

      {!data ? (
        <Muted>Loading…</Muted>
      ) : people.length === 0 ? (
        <Muted>Nobody matches that.</Muted>
      ) : (
        <div className="mt-3 grid gap-1.5">
          {people.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 p-2"
              style={{
                border: `1px solid ${alpha(P.ink, 0.1)}`,
                borderRadius: 8,
                fontSize: 12.5,
                background: p.id === data.me ? P.signalWash : "transparent",
                opacity: p.onLeaveToday ? 0.7 : 1,
              }}
            >
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              {p.jobTitle && <span style={{ color: P.sub }}>{p.jobTitle}</span>}
              {p.account && <span className="ao-mono" style={{ fontSize: 11, color: P.sub }}>{p.account}</span>}

              {/* The status, which is the reason the page is open. */}
              {p.loggedIn ? (
                <Pill color={P.green} filled><Radio size={10} />on now</Pill>
              ) : p.onLeaveToday ? (
                <Pill color={P.amber}><Plane size={10} />on leave</Pill>
              ) : p.shift ? (
                <Pill color={P.petrol}>
                  <Clock size={10} />
                  {p.shift.startTime}–{endTime(p.shift.startTime, p.shift.durationMinutes)}
                </Pill>
              ) : null}

              <span className="flex-1" />

              {/* Away days that are not today are worth knowing before you plan
                  anything with them, and are not the same answer as "away". */}
              {!p.onLeaveToday && p.awayThisWeek.length > 0 && (
                <span style={{ fontSize: 11, color: P.amber }}>
                  away {p.awayThisWeek.map((d) => d.slice(5)).join(", ")}
                </span>
              )}
              {p.managerName && <span style={{ fontSize: 11, color: P.sub }}>reports to {p.managerName}</span>}
              <a href={`mailto:${p.workEmail}`} className="ao-mono" style={{ fontSize: 11.5, color: P.petrol }}>
                {p.workEmail}
              </a>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

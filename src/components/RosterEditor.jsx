"use client";

/* Building the day's roster: one row per person, one choice per row.

   The shape is a deliberate rejection of the drag-and-drop timeline every WFM
   product ships. A timeline is beautiful in a demo and miserable at 07:40 on a
   Sunday when someone has called in sick and a lead needs to move four people
   in ninety seconds. What that person wants is a list they can tab down,
   picking a shape per name — so that is what this is.

   Two rules the interface enforces rather than explains:

     · Nothing saves until you say so. Every edit is local until Save, so a
       half-built roster cannot reach an agent's phone. The pending count is
       always visible, because the worst version of this screen is one where you
       cannot tell whether your changes went anywhere.

     · Publishing is separate from saving. A saved roster is a draft the planner
       is still working on; a published one is a promise someone will arrange
       childcare around. Making those the same button is how people end up
       planning their week around a draft. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, Save, Send, TriangleAlert, RotateCcw } from "lucide-react";

import { P, alpha } from "../lib/tokens.js";
import { SCHEDULE_ACTIVITIES, ACTIVITY_LIST, checkEntry } from "../lib/schedule.js";
import { SectionTitle, Muted, BtnGhost, BtnPrimary, TSelect } from "./ui/index.jsx";
import Tip from "./ui/Tip.jsx";

/** The row as it exists before anyone has touched it. */
const EMPTY = { activity: "", patternId: "", startTime: "", durationMinutes: 0, published: false, id: null };

const hours = (m) => `${Math.round((m / 60) * 10) / 10}h`;

export default function RosterEditor({ account, lob, date, onSaved }) {
  const [people, setPeople] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [existing, setExisting] = useState({});   // employeeId -> stored row
  const [draft, setDraft] = useState({});         // employeeId -> pending change
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!account || !date) return;
    setBusy(true);
    setError("");
    try {
      const [pe, pa, sc] = await Promise.all([
        fetch(`/api/wfm/people?account=${encodeURIComponent(account)}&lob=${encodeURIComponent(lob || "")}`),
        fetch("/api/wfm/patterns"),
        fetch(`/api/wfm/schedule?from=${date}&to=${date}&account=${encodeURIComponent(account)}&lob=${encodeURIComponent(lob || "")}`),
      ]);
      for (const r of [pe, pa, sc]) {
        if (!r.ok) throw new Error((await r.json()).error || "Could not load the roster.");
      }
      const peopleJson = await pe.json();
      const patternsJson = await pa.json();
      const scheduleJson = await sc.json();

      setPeople(peopleJson.people ?? []);
      setPatterns((patternsJson.patterns ?? []).filter((x) => x.active));
      const byPerson = {};
      for (const row of scheduleJson.rows ?? []) byPerson[row.employeeId] = row;
      setExisting(byPerson);
      setDraft({});
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [account, lob, date]);

  useEffect(() => { load(); }, [load]);

  /* What a row currently shows: the pending edit if there is one, otherwise
     what is stored, otherwise nothing. */
  const rowFor = useCallback(
    (id) => draft[id] ?? (existing[id] ? {
      activity: existing[id].activity,
      patternId: existing[id].patternId ?? "",
      startTime: existing[id].startTime,
      durationMinutes: existing[id].durationMinutes,
      published: existing[id].published,
      id: existing[id].id,
    } : EMPTY),
    [draft, existing]
  );

  const setRow = (id, patch) => setDraft((d) => ({ ...d, [id]: { ...rowFor(id), ...patch } }));

  /* Choosing a pattern copies its hours onto the row rather than referencing
     them, exactly as the API does — the roster is a promise about specific
     times, not a pointer to a template someone may edit next quarter. */
  const choosePattern = (id, patternId) => {
    const p = patterns.find((x) => x.id === patternId);
    setRow(id, {
      patternId,
      activity: "Shift",
      startTime: p?.startTime ?? "",
      durationMinutes: p?.durationMinutes ?? 0,
    });
  };

  const chooseActivity = (id, activity) => {
    if (activity === "") return setRow(id, { ...EMPTY });
    const covers = SCHEDULE_ACTIVITIES[activity]?.covers;
    const cur = rowFor(id);
    setRow(id, {
      activity,
      // A day off has no hours to speak of; everything else keeps what it had.
      ...(activity === "Off" ? { patternId: "", startTime: "", durationMinutes: 0 } : {}),
      ...(!covers && !cur.startTime ? { startTime: "09:00", durationMinutes: 480 } : {}),
    });
  };

  const pending = useMemo(() => Object.entries(draft).filter(([, v]) => v.activity !== ""), [draft]);
  const problems = useMemo(
    () =>
      pending.flatMap(([id, v]) => checkEntry({ employeeId: id, date, ...v }).map((p) => {
        const who = people.find((x) => x.id === id);
        return `${who?.fullNameEn ?? id}: ${p}`;
      })),
    [pending, date, people]
  );

  const save = async (publish) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const rows = pending.map(([employeeId, v]) => ({
        employeeId, date,
        activity: v.activity,
        startTime: v.startTime,
        durationMinutes: v.durationMinutes,
        patternId: v.patternId || null,
      }));
      if (rows.length === 0) throw new Error("Nothing has changed yet.");
      const res = await fetch("/api/wfm/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows, publish }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "The roster was refused.");
      setNotice(`${j.written} row${j.written === 1 ? "" : "s"} ${publish ? "published" : "saved as a draft"}.`);
      await load();
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const covered = people.filter((p) => SCHEDULE_ACTIVITIES[rowFor(p.id).activity]?.covers).length;
  const unset = people.filter((p) => !rowFor(p.id).activity).length;

  return (
    <div className="grid gap-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <SectionTitle count={people.length} tone={P.petrol}>Roster · {date}</SectionTitle>
          <Muted>
            {covered} on the queue, {unset} with nothing set. Choose a shape per person; nothing reaches anyone until
            you publish.
          </Muted>
        </div>
        <Tip label="Discard every pending change and reload what is stored">
          <BtnGhost icon={RotateCcw} onClick={load} disabled={busy || pending.length === 0}>Discard</BtnGhost>
        </Tip>
        <Tip label="Keep it as a draft — agents cannot see it yet">
          <BtnGhost icon={Save} onClick={() => save(false)} disabled={busy || pending.length === 0 || problems.length > 0}>
            Save draft{pending.length ? ` (${pending.length})` : ""}
          </BtnGhost>
        </Tip>
        <Tip label="Make it visible to the people on it — they will plan their week around this">
          <BtnPrimary icon={Send} onClick={() => save(true)} disabled={busy || pending.length === 0 || problems.length > 0}>
            Publish
          </BtnPrimary>
        </Tip>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8 }} role="alert">
          <TriangleAlert size={15} color={P.brick} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, color: P.inkSoft }}>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 p-3" style={{ background: P.greenWash, border: `1px solid ${alpha(P.green, 0.4)}`, borderRadius: 8 }} role="status">
          <CalendarCheck size={15} color={P.green} />
          <span style={{ fontSize: 13, color: P.inkSoft }}>{notice}</span>
        </div>
      )}
      {problems.length > 0 && (
        <div className="p-3" style={{ background: P.amberWash, border: `1px solid ${alpha(P.amber, 0.4)}`, borderRadius: 8 }}>
          <div className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 10.5, color: P.amber }}>
            Fix these before saving
          </div>
          <ul style={{ margin: "6px 0 0", paddingInlineStart: 18, fontSize: 12.5, color: P.inkSoft }}>
            {problems.slice(0, 6).map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      )}

      {patterns.length === 0 && (
        <Muted>
          No shift patterns are defined yet, so shifts have to be typed one at a time. WFM can add patterns — a named
          shape is one edit instead of four hundred.
        </Muted>
      )}

      <div style={{ overflowX: "auto", border: `1px solid ${P.line}`, borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
          <thead>
            <tr style={{ background: "var(--mist)" }}>
              {["Person", "ID", "Line", "Activity", "Shape", "Hours", ""].map((h) => (
                <th key={h} className="ao-disp uppercase tracking-wide" style={{ fontSize: 10, color: P.sub, padding: "8px 10px", textAlign: "start" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((person) => {
              const row = rowFor(person.id);
              const dirty = !!draft[person.id];
              const stored = existing[person.id];
              return (
                <tr
                  key={person.id}
                  className="ao-row"
                  style={{ borderTop: `1px solid ${P.line}`, background: dirty ? alpha(P.petrol, 0.06) : "transparent" }}
                >
                  <td style={{ padding: "6px 10px", color: P.ink, whiteSpace: "nowrap" }}>{person.fullNameEn}</td>
                  <td className="ao-mono" style={{ padding: "6px 10px", color: P.sub }}>{person.empId}</td>
                  <td style={{ padding: "6px 10px", color: P.sub }}>{person.lob || "—"}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <TSelect
                      value={row.activity}
                      onChange={(e) => chooseActivity(person.id, e.target.value)}
                      aria-label={`Activity for ${person.fullNameEn}`}
                      style={{ fontSize: 12.5, padding: "5px 8px", minWidth: 130 }}
                    >
                      <option value="">Not set</option>
                      {ACTIVITY_LIST.map((a) => (
                        <option key={a} value={a}>{SCHEDULE_ACTIVITIES[a].label}</option>
                      ))}
                    </TSelect>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <TSelect
                      value={row.patternId}
                      onChange={(e) => choosePattern(person.id, e.target.value)}
                      disabled={!SCHEDULE_ACTIVITIES[row.activity]?.paid || row.activity === "Off"}
                      aria-label={`Shift pattern for ${person.fullNameEn}`}
                      style={{ fontSize: 12.5, padding: "5px 8px", minWidth: 150 }}
                    >
                      <option value="">{row.startTime ? `${row.startTime} (ad hoc)` : "—"}</option>
                      {patterns.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} · {p.startTime} · {hours(p.durationMinutes)}</option>
                      ))}
                    </TSelect>
                  </td>
                  <td className="ao-mono" style={{ padding: "6px 10px", color: P.inkSoft, whiteSpace: "nowrap" }}>
                    {row.durationMinutes ? `${row.startTime} · ${hours(row.durationMinutes)}` : "—"}
                  </td>
                  <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                    {dirty ? (
                      <span className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 9.5, color: P.petrol }}>
                        Unsaved
                      </span>
                    ) : stored?.published ? (
                      <Tip label="Visible to this person">
                        <span className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 9.5, color: P.green }}>
                          Published
                        </span>
                      </Tip>
                    ) : stored ? (
                      <Tip label="Saved, but this person cannot see it yet">
                        <span className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 9.5, color: P.sub }}>
                          Draft
                        </span>
                      </Tip>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {people.length === 0 && !busy && (
              <tr>
                <td colSpan={7} style={{ padding: 18, textAlign: "center", color: P.sub, fontSize: 13 }}>
                  Nobody on this account can be rostered — applicants have not started and leavers have gone.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

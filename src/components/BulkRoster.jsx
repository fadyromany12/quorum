"use client";

/* Apply a shift pattern to a group, across a span of days, in one action.

   The grid below this builds one cell at a time, which is fine for a change and
   unusable for a month. Building a month by hand is why rosters get built in
   Excel and pasted in — and a roster that lives in Excel is a roster the
   coverage model, the leave engine and the exceptions screen cannot see.

   Three things this deliberately does before writing anything:

     · Previews the size. Forty people over March is 1,240 rows, which is past
       what one save can carry. Learning that from a 400 after selecting
       everybody is a worse way to find out than being told while selecting.

     · Refuses rather than half-writes. The whole batch is validated first, the
       API validates it again, and the write is one transaction. A roster that
       is short by however many rows failed, with nothing on screen saying so,
       is worse than one that was rejected.

     · Saves as a draft. Publishing is a separate, deliberate press, because
       people plan their week around a published roster and a bulk mistake
       reaches everyone at once. */

import { useMemo, useState } from "react";
import { CalendarRange, Layers, Send, Eye } from "lucide-react";
import { Card, Pill, Muted, BtnGhost, BtnPrimary, TInput, TSelect, Field } from "./ui/index.jsx";
import { P, alpha } from "../lib/tokens.js";
import { todayStr, addDays } from "../lib/dates.js";
import { plural } from "../lib/format.js";
import { bulkRows, WEEKDAYS, ACTIVITY_LIST, SCHEDULE_ACTIVITIES } from "../lib/schedule.js";
import { labelOf } from "../lib/i18n.js";
import { useLocale } from "../hooks/useLocale.jsx";

export default function BulkRoster({ people = [], patterns = [], onApplied }) {
  const locale = useLocale();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(addDays(todayStr(), 6));
  const [weekdays, setWeekdays] = useState([]);
  const [activity, setActivity] = useState("Shift");
  const [patternId, setPatternId] = useState("");
  const [selected, setSelected] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);

  const pattern = patterns.find((p) => p.id === patternId) ?? null;
  const covers = !!SCHEDULE_ACTIVITIES[activity]?.covers;

  const plan = useMemo(
    () => bulkRows({ employeeIds: selected, from, to, weekdays, pattern, activity, note }),
    [selected, from, to, weekdays, pattern, activity, note],
  );

  const toggleDay = (i) =>
    setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i].sort()));
  const togglePerson = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const apply = async (publish) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/wfm/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows: plan.rows, publish }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The roster was refused.");
      setNotice(
        `${plural(j.written, "row")} ${publish ? "published" : "saved as a draft"} across ` +
          `${plural(plan.days.length, "day")} for ${plural(selected.length, "person", "people")}.`,
      );
      setSelected([]);
      onApplied?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div>
        <BtnGhost icon={Layers} onClick={() => setOpen(true)}>
          Apply to many…
        </BtnGhost>
      </div>
    );
  }

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><Layers size={14} />Apply to many</span>}
      right={<BtnGhost onClick={() => setOpen(false)}>Close</BtnGhost>}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="From">
          <TInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <TInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Activity">
          <TSelect value={activity} onChange={(e) => setActivity(e.target.value)}>
            {ACTIVITY_LIST.map((a) => (
              <option key={a} value={a}>{labelOf(SCHEDULE_ACTIVITIES[a], locale, a)}</option>
            ))}
          </TSelect>
        </Field>
        <Field label="Pattern">
          <TSelect
            value={patternId}
            onChange={(e) => setPatternId(e.target.value)}
            /* A day off has no shape; offering one would invite a pattern to be
               attached to something that is not worked. */
            disabled={!covers}
          >
            <option value="">{covers ? "Choose a pattern…" : "Not needed"}</option>
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.startTime} · {Math.round(p.durationMinutes / 60)}h</option>
            ))}
          </TSelect>
        </Field>
      </div>

      {/* ── Which days of the week ── */}
      <div className="mt-3">
        <div className="ao-disp uppercase tracking-wider font-semibold" style={{ fontSize: 11, color: P.sub }}>
          Days of the week
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => {
            const on = weekdays.includes(d.index);
            return (
              <button
                key={d.index}
                type="button"
                onClick={() => toggleDay(d.index)}
                aria-pressed={on}
                className="ao-disp uppercase font-semibold transition"
                style={{
                  fontSize: 11, padding: "5px 10px", borderRadius: 7, cursor: "pointer",
                  border: `1px solid ${on ? P.petrol : P.line}`,
                  background: on ? P.signalWash : "transparent",
                  color: on ? P.ink : P.sub,
                }}
              >
                {d.short}
              </button>
            );
          })}
          <Muted>{weekdays.length ? "" : "every day"}</Muted>
        </div>
      </div>

      {/* ── Who ── */}
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <span className="ao-disp uppercase tracking-wider font-semibold" style={{ fontSize: 11, color: P.sub }}>
            Who
          </span>
          <BtnGhost onClick={() => setSelected(people.map((p) => p.id))}>Select all</BtnGhost>
          {selected.length > 0 && <BtnGhost onClick={() => setSelected([])}>Clear</BtnGhost>}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5" style={{ maxHeight: 160, overflowY: "auto" }}>
          {people.map((p) => {
            const on = selected.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePerson(p.id)}
                aria-pressed={on}
                className="transition"
                style={{
                  fontSize: 12, padding: "4px 9px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${on ? P.petrol : P.line}`,
                  background: on ? P.signalWash : "transparent",
                  color: on ? P.ink : P.sub,
                }}
              >
                {p.fullNameEn}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        <Field label="Note (optional)">
          <TInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ramadan hours" />
        </Field>
      </div>

      {/* ── What would be written ── */}
      <div className="mt-3 p-3" style={{ background: P.mist, borderRadius: 8, border: `1px solid ${P.line}` }}>
        <div className="flex flex-wrap items-center gap-2">
          <Eye size={13} color={P.sub} />
          {plan.problems.length === 0 ? (
            <>
              <Pill color={P.petrol} filled>{plural(plan.rows.length, "row")}</Pill>
              <Muted>
                {plural(selected.length, "person", "people")} × {plural(plan.days.length, "day")}
                {plan.days.length > 0 && ` · ${plan.days[0]} → ${plan.days[plan.days.length - 1]}`}
              </Muted>
            </>
          ) : (
            <span style={{ fontSize: 12.5, color: P.amber }}>{plan.problems[0]}</span>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-2 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 13 }} role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-2 p-3" style={{ background: P.greenWash, border: `1px solid ${alpha(P.green, 0.4)}`, borderRadius: 8, fontSize: 13 }} role="status">
          {notice}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <BtnGhost icon={CalendarRange} onClick={() => apply(false)} disabled={busy || plan.problems.length > 0}>
          {busy ? "Writing…" : "Save as draft"}
        </BtnGhost>
        <BtnPrimary icon={Send} onClick={() => apply(true)} disabled={busy || plan.problems.length > 0}>
          Publish
        </BtnPrimary>
        <Muted>
          A draft is invisible to the people on it. Publishing is what they plan their week around.
        </Muted>
      </div>
    </Card>
  );
}

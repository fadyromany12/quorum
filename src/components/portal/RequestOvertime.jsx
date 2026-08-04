"use client";

/* Ask to be paid for overtime worked.

   The request type has existed for a while and there was no way to raise one —
   and approving one did nothing, because payslips price overtime from roster
   rows and approval never wrote a row. So the hours were worked, the manager
   agreed, and the money never moved. This is the front of that loop; the back
   of it is in workflow-db, where settlement writes the roster row.

   Hours rather than a finish time, because that is the number the agent knows
   ("I stayed about two hours") and the one the approver decides on. A finish
   time makes them do arithmetic to answer a question nobody asked.

   The approver can grant fewer hours than were asked for — the type is
   `partial` — so this deliberately does not promise the full amount anywhere in
   its wording. */

import { useCallback, useEffect, useState } from "react";
import { Clock, Send } from "lucide-react";
import { Card, Muted, BtnPrimary, TInput, TArea, Field } from "../ui/index.jsx";
import { P, alpha } from "../../lib/tokens.js";
import { todayStr } from "../../lib/dates.js";
import { checkOvertime } from "../../lib/schedule.js";

export default function RequestOvertime() {
  const [date, setDate] = useState(todayStr());
  const [startTime, setStartTime] = useState("");
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [shifts, setShifts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /* The agent's own published shifts, so the form can tell them a start time
     that falls inside one they were already paid for. */
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wfm/schedule/swappable");
      const j = await res.json().catch(() => ({}));
      if (res.ok) setShifts(j.mine ?? []);
    } catch {
      /* The shift list only sharpens a warning; without it the form still
         works and the server still validates. */
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shift = shifts.find((s) => s.date === date) ?? null;
  const problems = checkOvertime({ date, startTime, hours, shift });
  const ready = problems.length === 0 && !busy;

  const submit = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "overtime",
          requestedUnits: Number(hours),
          payload: { date, startTime, hours: Number(hours), reason },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The request was refused.");
      setNotice(
        "Sent to your lead. If they approve it, the hours appear on your roster and on your payslip — " +
          "they can approve fewer hours than you asked for.",
      );
      setStartTime("");
      setHours("");
      setReason("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={<span className="inline-flex items-center gap-2"><Clock size={14} />Claim overtime</span>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Day worked">
          <TInput type="date" max={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Started at">
          <TInput type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
        <Field label="Hours">
          <TInput type="number" step="0.5" min="0.5" max="12" placeholder="2" value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Why (optional)">
          <TArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Covered the evening queue after two call-outs" />
        </Field>
      </div>

      {shift && (
        <Muted>
          You were rostered {shift.startTime} for {Math.round((shift.durationMinutes || 0) / 60)}h that day.
        </Muted>
      )}

      {/* Told now rather than by a manager two days later. */}
      {problems.length > 0 && (hours || startTime) && (
        <div className="mt-2" style={{ fontSize: 12.5, color: P.amber }}>{problems[0]}</div>
      )}

      {error && (
        <div className="mt-3 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 13 }} role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-3 p-3" style={{ background: P.greenWash, border: `1px solid ${alpha(P.green, 0.4)}`, borderRadius: 8, fontSize: 13 }} role="status">
          {notice}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <BtnPrimary icon={Send} onClick={submit} disabled={!ready}>
          {busy ? "Sending…" : "Send to my lead"}
        </BtnPrimary>
        <Muted>Nothing is paid until your lead approves it.</Muted>
      </div>
    </Card>
  );
}

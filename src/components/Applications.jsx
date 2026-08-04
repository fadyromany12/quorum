"use client";

/* Applications waiting on you.

   A self sign-up is an account that exists and does not work, and the only
   thing standing between those two states is somebody here pressing a button.
   So this sits above the joiners directory rather than inside it: an applicant
   who is waiting is not a row to browse, they are a decision that has not been
   made, and they stop appearing the moment it is.

   Nothing renders when the queue is empty. A permanently visible empty panel
   above the directory teaches people to scroll past the place decisions
   appear. */

import { useCallback, useEffect, useState } from "react";
import { UserPlus, Check, X, Clock } from "lucide-react";
import { Card, Muted, Pill, BtnGhost, TArea } from "./ui/index.jsx";
import { P, alpha } from "../lib/tokens.js";
import { todayStr } from "../lib/dates.js";
import { ageAt } from "../lib/employee.js";

/** How long they have been waiting, in the words a person would use. */
function waitingFor(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "since yesterday";
  return `${days} days`;
}

export default function Applications() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notes, setNotes] = useState({});
  const [rejecting, setRejecting] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/signup/applications");
      const j = await res.json().catch(() => ({}));
      if (res.ok) setRows(j.applications ?? []);
    } catch {
      /* An empty queue and an unreachable one look the same here, which is
         acceptable: the panel simply does not appear, and the applications are
         still in the joiners directory. */
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (id, decision) => {
    setBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/signup/applications/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note: notes[id] ?? "" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "That did not work.");
      setRows((rs) => rs.filter((r) => r.id !== id));
      setRejecting("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  if (!rows.length) return null;

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><UserPlus size={14} />Waiting for you</span>}
      right={<Pill color={P.amber} filled><Clock size={11} />{rows.length}</Pill>}
      accent={alpha(P.amber, 0.33)}
    >
      <Muted>
        These people signed up themselves and chose you as their manager. Approving one turns their login on and moves
        them into Onboarding; until then they cannot sign in at all.
      </Muted>

      {error && (
        <div className="mt-3 p-3" role="alert" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="mt-3 grid gap-2">
        {rows.map((r) => {
          const age = ageAt(r.birthDate, todayStr());
          return (
            <div key={r.id} className="p-3" style={{ border: `1px solid ${alpha(P.ink, 0.12)}`, borderRadius: 9 }}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <strong style={{ fontSize: 14 }}>{r.fullNameEn}</strong>
                {r.fullNameAr && <span style={{ fontSize: 13, color: P.sub }} dir="rtl">{r.fullNameAr}</span>}
                <span className="ao-mono" style={{ fontSize: 11.5, color: P.sub }}>{r.empId}</span>
                <span className="flex-1" />
                <span style={{ fontSize: 11.5, color: P.sub }}>Waiting {waitingFor(r.createdAt)}</span>
              </div>

              <div className="mt-1" style={{ fontSize: 12.5, color: P.inkSoft }}>
                {[r.jobTitle, r.workEmail, r.phone, age == null ? "" : `${age}`].filter(Boolean).join(" · ")}
              </div>
              {r.managerName && (
                <div style={{ fontSize: 11.5, color: P.sub }}>Chose {r.managerName} as their manager.</div>
              )}

              {/* A decline stays on the record and may be read years later, so
                  the reason is asked for here rather than left blank. */}
              {rejecting === r.id && (
                <div className="mt-2">
                  <TArea
                    rows={2}
                    autoFocus
                    placeholder="Why are you declining? They may ask, and this stays on the record."
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  />
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {rejecting === r.id ? (
                  <>
                    <BtnGhost
                      color={P.brick}
                      icon={X}
                      disabled={busy === r.id || !(notes[r.id] ?? "").trim()}
                      onClick={() => decide(r.id, "reject")}
                    >
                      {busy === r.id ? "Declining…" : "Confirm decline"}
                    </BtnGhost>
                    <BtnGhost onClick={() => setRejecting("")}>Back</BtnGhost>
                  </>
                ) : (
                  <>
                    <BtnGhost color={P.green} icon={Check} disabled={busy === r.id} onClick={() => decide(r.id, "approve")}>
                      {busy === r.id ? "Approving…" : "Approve"}
                    </BtnGhost>
                    <BtnGhost color={P.brick} icon={X} onClick={() => setRejecting(r.id)}>Decline</BtnGhost>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

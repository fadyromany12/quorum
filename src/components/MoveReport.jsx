"use client";

/* Move somebody to a different manager.

   Until now this was a field edit: open the record, change directManagerId,
   save. One person, no conversation, no trace beyond a field diff — and it
   silently changes who approves that person's leave and who can read their
   record. Both of those are decisions somebody should have agreed to.

   So it is a request with two approvers: the manager releasing them and the
   manager taking them. Neither can overrule the other.

   The part worth building carefully is the preview. A reporting-line change is
   never only about the person named — if they manage anybody, their whole team
   comes with them — and neither manager should find that out afterwards. The
   plan runs in the browser as they choose, against the same function that runs
   again at settlement. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { GitBranch, Send, TriangleAlert } from "lucide-react";
import { Card, Muted, BtnPrimary, TSelect, TArea, Field, Toggle } from "./ui/index.jsx";
import { P, alpha } from "../lib/tokens.js";
import { movePlan, nameOf } from "../lib/hierarchy.js";

/** Flatten the tree the org endpoint returns back into a list of people. */
function flatten(nodes, out = []) {
  for (const n of nodes) {
    if (n.employee) out.push(n.employee);
    flatten(n.children ?? [], out);
  }
  return out;
}

export default function MoveReport() {
  const [people, setPeople] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [newManagerId, setNewManagerId] = useState("");
  const [alsoFunctional, setAlsoFunctional] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/org");
    const j = await res.json().catch(() => ({}));
    if (res.ok) setPeople(flatten(j.roots ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(
    () => [...people].sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [people],
  );

  /* The same function the server runs at settlement. Here it exists so the two
     managers can see what they are agreeing to before anyone is asked. */
  const plan = useMemo(
    () => (employeeId ? movePlan(employeeId, newManagerId, people) : null),
    [employeeId, newManagerId, people],
  );

  const person = people.find((p) => p.id === employeeId) ?? null;
  const gainer = people.find((p) => p.id === newManagerId) ?? null;
  const ready = Boolean(employeeId && newManagerId && plan && plan.problems.length === 0 && reason.trim() && !busy);

  const submit = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "reportingLine",
          subjectId: employeeId,
          payload: { newManagerId, alsoFunctional, reason, movingCount: plan?.moving.length ?? 1 },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "The request was refused.");
      setNotice(
        `Sent to ${plan?.losing ? `${nameOf(people.find((p) => p.id === plan.losing))} and ` : ""}` +
          `${nameOf(gainer)}. Nothing moves until both agree.`,
      );
      setEmployeeId("");
      setNewManagerId("");
      setReason("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={<span className="inline-flex items-center gap-2"><GitBranch size={14} />Change a reporting line</span>}>
      <Muted>
        Both managers approve — the one releasing them and the one taking them. Neither can overrule the other, and
        nothing changes until both have agreed.
      </Muted>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Who is moving">
          <TSelect value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Choose…</option>
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>{nameOf(p)}{p.jobTitle ? ` — ${p.jobTitle}` : ""}</option>
            ))}
          </TSelect>
        </Field>
        <Field label="Their new manager">
          <TSelect value={newManagerId} onChange={(e) => setNewManagerId(e.target.value)} disabled={!employeeId}>
            <option value="">Choose…</option>
            {sorted.filter((p) => p.id !== employeeId).map((p) => (
              <option key={p.id} value={p.id}>{nameOf(p)}{p.account ? ` · ${p.account}` : ""}</option>
            ))}
          </TSelect>
        </Field>
      </div>

      {person && (
        <div className="mt-2" style={{ fontSize: 12.5, color: P.inkSoft }}>
          {plan?.losing
            ? `${nameOf(person)} reports to ${nameOf(people.find((p) => p.id === plan.losing))} today.`
            : `${nameOf(person)} reports to nobody today.`}
        </div>
      )}

      {/* The refusal, in the words of what it would break. */}
      {plan?.problems.length > 0 && (
        <div
          className="mt-3 p-3"
          style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 12.5 }}
        >
          <TriangleAlert size={12} style={{ display: "inline", marginInlineEnd: 6, color: P.brick }} />
          {plan.problems[0]}
        </div>
      )}

      {/* And the consequences that are allowed but should not be a surprise. */}
      {plan && plan.problems.length === 0 && plan.warnings.length > 0 && (
        <div className="mt-3 p-3" style={{ background: P.amberWash, border: `1px solid ${alpha(P.amber, 0.4)}`, borderRadius: 8, fontSize: 12.5 }}>
          {plan.warnings.map((w) => <div key={w}>{w}</div>)}
        </div>
      )}

      {plan && plan.problems.length === 0 && newManagerId && (
        <div className="mt-3">
          <Toggle
            on={alsoFunctional}
            onClick={() => setAlsoFunctional((v) => !v)}
            label="Move the functional line too"
            title="Leave approval routes through the functional manager first. On a cross-account move, leaving it behind sends the new team's leave to the old account."
          />
        </div>
      )}

      <div className="mt-3">
        <Field label="Why">
          <TArea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Rebalancing the Lenovo evening team after two leavers"
          />
        </Field>
      </div>

      {error && (
        <div className="mt-3 p-3" role="alert" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-3 p-3" role="status" style={{ background: P.greenWash, border: `1px solid ${alpha(P.green, 0.4)}`, borderRadius: 8, fontSize: 13 }}>
          {notice}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <BtnPrimary icon={Send} onClick={submit} disabled={!ready}>
          {busy ? "Sending…" : "Send to both managers"}
        </BtnPrimary>
        <Muted>A reason is required — this changes who approves their leave.</Muted>
      </div>
    </Card>
  );
}

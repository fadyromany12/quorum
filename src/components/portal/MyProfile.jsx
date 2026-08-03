"use client";

/* My record — what the company holds about me, and which parts I can change.

   The screen is organised by who owns each field rather than by what the field
   is about, because that is the only grouping that answers the question people
   actually arrive with: "why can't I fix this?" A form that mixes an editable
   mobile number with an uneditable job title and explains neither reads as
   broken. Three sections, each stating its own rule once, reads as a policy.

     Yours            saves when you press save, and is recorded.
     Needs checking   becomes a request; nothing changes until HR sees the
                      document. The field keeps showing the current value, with
                      the proposed one beside it — replacing it on submit would
                      claim a change that has not happened.
     Held by HR       shown, never editable, with the route to dispute it.

   The tiers come from profile-policy.js, which the API enforces with. Nothing
   here decides what is editable — it asks. A screen that hardcoded the list
   would be a second source of truth about permissions, and the second one goes
   stale the day someone moves a field between tiers.

   Completeness is deliberately not a nag bar. It names the missing fields and
   separates the ones that genuinely block payroll from the ones that are merely
   absent, because "78% complete" with no list is a puzzle, and a puzzle gets
   ignored. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IdCard, Save, RefreshCw, ShieldCheck, Lock, Check, Clock, TriangleAlert, CircleAlert,
} from "lucide-react";
import { Card, Pill, Muted, BtnPrimary, BtnGhost, TInput, TSelect } from "../ui/index.jsx";
import { P, alpha } from "../../lib/tokens.js";
import { fmtDate } from "../../lib/format.js";

/* Which control a field wants. Everything not named here is a plain text box —
   listing the exceptions is shorter and does not need updating when a field is
   added to the policy. */
const INPUT = {
  birthDate: "date",
  hireDate: "date",
  personalEmail: "email",
  phone: "tel",
  emergencyPhone: "tel",
  linkedInUrl: "url",
  maritalStatus: ["", "Single", "Married", "Divorced", "Widowed"],
};

const TIER_META = {
  self: {
    title: "Yours to change",
    icon: Check,
    color: P.green,
    rule: "Saves as soon as you press save. Every change is recorded against your name.",
  },
  verified: {
    title: "Needs checking first",
    icon: ShieldCheck,
    color: P.amber,
    rule:
      "These decide what you are owed or where you are paid, so HR checks them against a document. " +
      "Submitting raises a request — nothing changes until it is approved.",
  },
  hrHeld: {
    title: "Held by HR",
    icon: Lock,
    color: "var(--dim)",
    rule: "Employment facts, set by HR. If one of these is wrong, raise it with HR rather than editing it.",
  },
};

const TIER_ORDER = ["self", "verified", "hrHeld"];

/* A real <label for> bound to the input.

   The shared Label renders a <div>, which looks identical and is invisible to a
   screen reader: every box on this form would announce as an unlabelled text
   field, on the one screen in the product where a blind employee is most likely
   to be working alone. Fixed here rather than in ui/index.jsx because <label>
   is inline where <div> is block, and swapping it under twenty other
   components would move layouts nobody asked me to touch.

   The id is also what makes this screen testable by field name rather than by
   guessing at DOM position. */
function FieldRow({ field, label, children }) {
  return (
    <div>
      <label
        htmlFor={`profile-${field}`}
        className="ao-disp uppercase tracking-wider font-semibold block"
        style={{ fontSize: 11, color: P.sub }}
      >
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export default function MyProfile() {
  const [state, setState] = useState(null); // { employee, pii, completeness, policy }
  const [draft, setDraft] = useState({}); // only fields the person has touched
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  /* Fields sitting in an open profileChange request. Kept separate from `draft`
     so a proposal survives a reload and is never mistaken for an unsaved edit. */
  const [proposed, setProposed] = useState({});

  const load = useCallback(async () => {
    setError("");
    try {
      const [meRes, reqRes] = await Promise.all([
        fetch("/api/me/profile"),
        fetch("/api/requests?view=mine"),
      ]);
      const me = await meRes.json().catch(() => ({}));
      if (!meRes.ok) throw new Error(me.error || "Could not load your record.");
      setState(me);
      setDraft({});

      /* Anything already awaiting HR. Reading it from the requests the engine
         owns means the banner cannot disagree with the approvals inbox. */
      const reqJson = await reqRes.json().catch(() => ({}));
      const open = {};
      for (const r of reqJson.requests ?? []) {
        if (r.type !== "profileChange" || r.status !== "pending") continue;
        for (const [f, v] of Object.entries(r.payload?.fields ?? {})) open[f] = v;
      }
      setProposed(open);
    } catch (err) {
      setError(err.message);
      setState((s) => s ?? { employee: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const policy = state?.policy ?? {};
  const valueOf = useCallback(
    (field) => {
      const p = policy[field];
      if (!p) return "";
      const src = p.entity === "pii" ? state?.pii : state?.employee;
      return src?.[field] ?? "";
    },
    [policy, state],
  );

  /* Fields grouped by tier, in policy order so the layout is stable between
     renders and between people. */
  const byTier = useMemo(() => {
    const out = { self: [], verified: [], hrHeld: [] };
    for (const [field, p] of Object.entries(policy)) out[p.tier]?.push(field);
    return out;
  }, [policy]);

  const dirty = Object.keys(draft);
  const dirtySelf = dirty.filter((f) => policy[f]?.tier === "self");
  const dirtyVerified = dirty.filter((f) => policy[f]?.tier === "verified");

  async function save() {
    if (!dirty.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: draft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save.");

      /* Say what happened to each part rather than "Saved". One press can apply
         two fields immediately and send a third to HR, and a single cheerful
         confirmation would hide the half that has not taken effect. */
      const said = [];
      if (json.applied?.length) {
        said.push(`Saved ${json.applied.map((f) => policy[f]?.label ?? f).join(", ")}.`);
      }
      if (json.pendingVerification?.length) {
        said.push(
          `Sent to HR for checking: ${json.pendingVerification.map((f) => policy[f]?.label ?? f).join(", ")}. ` +
            "These stay as they are until approved.",
        );
      }
      setNotice(said.join(" ") || "Nothing changed.");
      if (json.refused?.length) setError(json.refused.map((r) => r.reason).join(" "));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <Card title="My record">
        <Muted>{error || "Loading…"}</Muted>
      </Card>
    );
  }

  /* No employment record behind the login. Says who fixes it rather than
     failing blankly — this is the state a new joiner sees on day one. */
  if (!state.employee) {
    return (
      <Card title="My record">
        <div className="flex items-start gap-2" style={{ color: P.amber, fontSize: 13 }}>
          <CircleAlert size={15} className="shrink-0 mt-0.5" />
          <span>{error || "Your login is not linked to an employment record yet — HR can link it."}</span>
        </div>
      </Card>
    );
  }

  const c = state.completeness ?? { pct: 0, missing: [], blocked: false };

  return (
    <Card
      title="My record"
      right={
        <div className="flex items-center gap-2">
          <Pill color={c.blocked ? P.brick : c.pct === 100 ? P.green : P.amber}>
            {c.pct}% complete
          </Pill>
          <BtnGhost icon={RefreshCw} onClick={load} title="Reload from the record">
            Refresh
          </BtnGhost>
        </div>
      }
    >
      {/* ── What is missing, and whether it actually stops anything ── */}
      {c.missing.length > 0 && (
        <div
          className="mb-4 p-3"
          style={{
            background: c.blocked ? P.brickWash : P.amberWash,
            border: `1px solid ${alpha(c.blocked ? P.brick : P.amber, 0.4)}`,
            borderRadius: 8,
          }}
        >
          <div className="flex items-center gap-2" style={{ fontSize: 12.5, fontWeight: 600, color: c.blocked ? P.brick : P.amber }}>
            <TriangleAlert size={14} />
            {c.blocked ? "Some of this stops you being paid" : "A few details are missing"}
          </div>
          <ul className="mt-2 grid gap-1" style={{ fontSize: 12.5, color: P.ink }}>
            {c.missing.map((m) => (
              <li key={m.field}>
                <span style={{ fontWeight: m.blocking ? 600 : 400 }}>{m.label}</span>
                {m.why && <span style={{ color: P.sub }}> — {m.why}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mb-3 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8, fontSize: 13 }} role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 p-3" style={{ background: P.greenWash, border: `1px solid ${alpha(P.green, 0.4)}`, borderRadius: 8, fontSize: 13 }} role="status">
          {notice}
        </div>
      )}

      <div className="grid gap-5">
        {TIER_ORDER.map((tier) => {
          const fields = byTier[tier] ?? [];
          if (!fields.length) return null;
          const meta = TIER_META[tier];
          const Icon = meta.icon;
          return (
            <section key={tier}>
              <div className="flex items-center gap-2" style={{ color: meta.color, fontSize: 12, fontWeight: 700, letterSpacing: 0.4 }}>
                <Icon size={13} />
                <span className="uppercase">{meta.title}</span>
              </div>
              <p className="mt-1 mb-2.5" style={{ fontSize: 12, color: P.sub, lineHeight: 1.5 }}>{meta.rule}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((field) => {
                  const p = policy[field];
                  const current = valueOf(field);
                  const editable = tier !== "hrHeld";
                  const awaiting = Object.hasOwn(proposed, field);
                  const shown = Object.hasOwn(draft, field) ? draft[field] : current;
                  const kind = INPUT[field];
                  return (
                    <FieldRow key={field} field={field} label={p.label}>
                      {Array.isArray(kind) ? (
                        <TSelect
                          id={`profile-${field}`}
                          value={shown ?? ""}
                          disabled={!editable}
                          onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                        >
                          {kind.map((o) => (
                            <option key={o} value={o}>{o || "—"}</option>
                          ))}
                        </TSelect>
                      ) : (
                        <TInput
                          id={`profile-${field}`}
                          type={kind || "text"}
                          value={
                            /* Dates arrive as ISO strings with a time on them;
                               a date input shows nothing unless it gets exactly
                               yyyy-mm-dd. */
                            kind === "date" ? String(shown ?? "").slice(0, 10) : (shown ?? "")
                          }
                          disabled={!editable}
                          onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                          style={!editable ? { opacity: 0.72, cursor: "not-allowed" } : undefined}
                        />
                      )}
                      {awaiting && (
                        <div className="mt-1 flex items-center gap-1.5" style={{ fontSize: 11.5, color: P.amber }}>
                          <Clock size={11} />
                          Waiting on HR: {String(proposed[field]).slice(0, 40)}
                        </div>
                      )}
                    </FieldRow>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* ── Save ──
          The button says which of the two things will happen, because they are
          genuinely different and the difference is the point of the tiers. */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <BtnPrimary icon={Save} onClick={save} disabled={busy || !dirty.length}>
          {busy ? "Saving…" : "Save changes"}
        </BtnPrimary>
        {dirty.length > 0 && (
          <Muted>
            {dirtySelf.length > 0 && `${dirtySelf.length} will save now`}
            {dirtySelf.length > 0 && dirtyVerified.length > 0 && " · "}
            {dirtyVerified.length > 0 && `${dirtyVerified.length} will go to HR for checking`}
          </Muted>
        )}
        {!dirty.length && <Muted>Nothing changed yet.</Muted>}
        {state.employee.hireDate && (
          <span className="ms-auto" style={{ fontSize: 11.5, color: P.sub }}>
            <IdCard size={11} className="inline me-1" />
            {state.employee.empId} · joined {fmtDate(state.employee.hireDate)}
          </span>
        )}
      </div>
    </Card>
  );
}

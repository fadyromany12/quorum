"use client";

/* The digital acknowledgement flow.

   Finalized disciplinary cases arrive here flagged requiresAcknowledgement.
   The agent opens one, reads the violation and the prescribed action, ticks
   the statement and types their full legal name. The server stamps the case
   and writes the immutable AuditLog row; router.refresh() then re-renders the
   dashboard from the database, so the alert shrinks by exactly one. */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Signature, ShieldAlert, FileWarning, ChevronRight, FileText, Gavel } from "lucide-react";
import { GlassCard, GlassModal, GlassButton, GlassInput, GlassLabel, GlassBadge } from "@/components/glass";
import { t } from "@/lib/i18n.js";

export type PendingAck = {
  id: string;
  date: string;
  violation: string;
  occurrence: number | null;
  action: string;
  severity: string | null;
  deductionApplied: number;
  investigation: boolean;
  appealState: string;
};

const SEV_TONE: Record<string, "neutral" | "amber" | "rose" | "violet"> = {
  Minor: "neutral",
  Moderate: "amber",
  Serious: "rose",
  "Zero Tolerance": "violet",
};

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

export default function AckCenter({ pending, locale = "en" }: { pending: PendingAck[]; locale?: string }) {
  const router = useRouter();
  const [active, setActive] = useState<PendingAck | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealReason, setAppealReason] = useState("");
  const [appealState, setAppealState] = useState("");

  if (!pending.length) return null;

  const open = (c: PendingAck) => {
    setActive(c);
    setAccepted(false);
    setSignature("");
    setError("");
    setAppealOpen(false);
    setAppealReason("");
    setAppealState(c.appealState || "");
  };

  const submitAppeal = async () => {
    if (!active || appealReason.trim().length < 10) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/cases/appeal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: active.id, reason: appealReason.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error || "Could not submit the appeal.");
    setAppealState("pending");
    setAppealOpen(false);
    router.refresh();
  };

  const close = () => {
    if (!busy) setActive(null);
  };

  const sign = async (e: FormEvent) => {
    e.preventDefault();
    if (!active) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/cases/acknowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: active.id, signature: signature.trim(), accepted }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || "Could not record the signature.");
      setBusy(false);
      return;
    }
    setBusy(false);
    setActive(null);
    router.refresh();
  };

  const canSign = accepted && signature.trim().length >= 5 && signature.trim().includes(" ");

  return (
    <>
      <GlassCard glow="violet" className="border-violet-400/25">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-violet-400/30 bg-violet-500/15 text-violet-300">
            <Signature size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-violet-200">
              {t(locale, "portal.pendingAcks")} — {pending.length}
            </h2>
            <p className="text-[12.5px] text-slate-400">{t(locale, "portal.pendingBlurb")}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          {pending.map((c) => (
            <button
              key={c.id}
              onClick={() => open(c)}
              className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-left transition hover:border-violet-400/30 hover:bg-white/10"
            >
              <FileWarning size={14} className="shrink-0 text-violet-300" />
              <span className="font-mono text-[12px] text-slate-300">{c.date}</span>
              <span className="text-[13px] font-medium text-slate-100">
                {c.violation}
                {c.occurrence ? ` · ${ordinal(c.occurrence)} occurrence` : ""}
              </span>
              {c.severity && <GlassBadge tone={SEV_TONE[c.severity] || "neutral"}>{c.severity}</GlassBadge>}
              <span className="flex-1" />
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide text-violet-300">
                {t(locale, "portal.reviewSign")} <ChevronRight size={13} className="rtl:rotate-180" />
              </span>
            </button>
          ))}
        </div>
      </GlassCard>

      <GlassModal open={!!active} onClose={close} title="Digital acknowledgement" wide>
        {active && (
          <form onSubmit={sign} className="grid gap-4">
            {/* What is being acknowledged */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {active.severity && <GlassBadge tone={SEV_TONE[active.severity] || "neutral"}>{active.severity}</GlassBadge>}
                <span className="font-mono text-[12px] text-slate-400">{active.date}</span>
                {active.occurrence && <GlassBadge tone="neutral">{ordinal(active.occurrence)} occurrence</GlassBadge>}
              </div>
              <div className="mt-2 text-[15px] font-semibold text-slate-100">{active.violation}</div>
              <div className="mt-3 rounded-lg border border-violet-400/25 bg-violet-500/10 px-3.5 py-2.5">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-violet-300">
                  Prescribed action
                </div>
                <div className="mt-0.5 text-[15px] font-bold text-violet-100">{active.action}</div>
                {active.deductionApplied > 0 && (
                  <div className="mt-1 text-[12px] text-slate-300">
                    Salary deduction to be executed: <b>{active.deductionApplied} day{active.deductionApplied === 1 ? "" : "s"}</b>{" "}
                    (already capped per Egyptian Labour Law No. 12/2003 — max 5 days per incident and per month).
                  </div>
                )}
              </div>
              {active.investigation && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-rose-200">
                  <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Investigation protocols apply to this case. You hold the right to a <b>3–5 working day</b> written
                    response window and to have a colleague present during any review. Signing here acknowledges
                    receipt — it does not waive those rights.
                  </span>
                </div>
              )}
            </div>

            {/* The formal letter, for the record */}
            <a
              href={`/api/cases/${active.id}/letter`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-violet-300 hover:text-violet-200"
            >
              <FileText size={14} />
              {t(locale, "portal.downloadLetter")}
            </a>

            {/* Right to contest */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-3.5">
              {appealState === "pending" ? (
                <p className="inline-flex items-center gap-2 text-[12.5px] text-amber-300">
                  <Gavel size={14} /> {t(locale, "portal.appealPending")}
                </p>
              ) : appealState ? (
                <p className="inline-flex items-center gap-2 text-[12.5px] text-slate-300">
                  <Gavel size={14} /> Appeal {appealState === "overturned" ? "granted — this case was overturned" : "reviewed — the decision stands"}.
                </p>
              ) : appealOpen ? (
                <div className="grid gap-2">
                  <GlassLabel>{t(locale, "portal.appealPrompt")}</GlassLabel>
                  <textarea
                    value={appealReason}
                    onChange={(e) => setAppealReason(e.target.value)}
                    rows={3}
                    placeholder="Explain what you believe is incorrect (at least 10 characters)…"
                    className="w-full rounded-lg border border-white/10 bg-white/5 p-2.5 text-[13px] text-slate-100 outline-none focus:border-amber-400/40"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <GlassButton type="button" variant="ghost" onClick={() => setAppealOpen(false)} disabled={busy}>
                      Cancel
                    </GlassButton>
                    <GlassButton type="button" variant="primary" onClick={submitAppeal} loading={busy} disabled={appealReason.trim().length < 10}>
                      <Gavel size={14} /> {t(locale, "portal.appealSubmit")}
                    </GlassButton>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAppealOpen(true)}
                  className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-amber-300 hover:text-amber-200"
                >
                  <Gavel size={14} /> I disagree — appeal this decision
                </button>
              )}
            </div>

            {/* The statement + signature */}
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3.5">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => {
                  setAccepted(e.target.checked);
                  setError("");
                }}
                className="mt-0.5 h-4 w-4 accent-emerald-400"
              />
              <span className="text-[13px] leading-relaxed text-slate-200">
                I have read and understood the Disciplinary Matrix, and I acknowledge the violation and the prescribed
                action recorded above.
              </span>
            </label>

            <div>
              <GlassLabel>Type your full legal name to sign</GlassLabel>
              <GlassInput
                value={signature}
                placeholder="e.g. Nour Ahmed Said"
                onChange={(e) => {
                  setSignature(e.target.value);
                  setError("");
                }}
              />
              <p className="mt-1.5 text-[11.5px] text-slate-500">
                Your signature and timestamp are recorded permanently in the audit log.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-[12.5px] text-rose-300">
                {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-3">
              <GlassButton type="button" variant="ghost" onClick={close} disabled={busy}>
                Not now
              </GlassButton>
              <GlassButton type="submit" variant="violet" loading={busy} disabled={!canSign}>
                <Signature size={14} />
                Sign &amp; acknowledge
              </GlassButton>
            </div>
          </form>
        )}
      </GlassModal>
    </>
  );
}

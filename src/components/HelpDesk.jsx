"use client";

/* The account-recovery desk.

   One screen with two actions, because at 2am there are only two things this
   person does: give someone a code, or kill a code someone did not ask for.
   Anything else on this screen is a thing to read past while a caller waits.

   The copy does a job the permissions cannot. IT can issue a code; IT cannot
   see or set a password, and the interface says so where the code appears
   rather than in a policy document nobody opens. The most likely security
   failure here is not a technical one — it is a helpful person on a phone
   agreeing to "just set it to something and tell me". The screen answers that
   before it is asked. */

import { useState } from "react";
import { KeyRound, ShieldOff, Copy, Check, TriangleAlert, Info } from "lucide-react";

import { P, alpha } from "../lib/tokens.js";
import { SectionTitle, Muted, BtnPrimary, BtnGhost, TInput, Field } from "./ui/index.jsx";
import Tip from "./ui/Tip.jsx";
import { CODE_TTL_MINUTES, DELIVERY } from "../lib/reset.js";

export default function HelpDesk({ canRevoke }) {
  const [email, setEmail] = useState("");
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  const call = async (path, body) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "That did not work.");
      return j;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    setIssued(null);
    setCopied(false);
    const j = await call("/api/reset/issue", { email: email.trim() });
    if (j?.code) setIssued(j);
  };

  const revoke = async () => {
    setIssued(null);
    const j = await call("/api/reset/revoke", { email: email.trim() });
    if (j) setNotice(j.message);
  };

  return (
    <div className="grid gap-5" style={{ maxWidth: 720 }}>
      <div>
        <SectionTitle tone={P.petrol}>Help desk</SectionTitle>
        <Muted>
          Issue a one-time code so someone locked out can set their own password, or kill a code somebody reports they
          did not ask for.
        </Muted>
      </div>

      {/* The standing instruction, above the controls rather than below them. */}
      <div className="flex items-start gap-2 p-3" style={{ background: "var(--signal-soft)", borderRadius: 10 }}>
        <Info size={15} color={P.petrol} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: P.inkSoft, lineHeight: 1.55 }}>
          <strong style={{ fontWeight: 600 }}>You never see or set anyone&rsquo;s password.</strong> The code below only
          lets the employee choose their own. If a caller asks you to set one for them, the answer is no — not because
          of a rule, but because a password you know is one they can later say they never used.
        </div>
      </div>

      <div className="p-4 grid gap-3" style={{ background: P.card, border: `1px solid ${P.line}`, borderRadius: 12 }}>
        <Field label="Their work email">
          <TInput
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@konecta.com"
            type="email"
            autoComplete="off"
            onKeyDown={(e) => e.key === "Enter" && email.trim() && issue()}
          />
        </Field>
        <div className="flex items-center gap-2 flex-wrap">
          <BtnPrimary icon={KeyRound} onClick={issue} disabled={busy || !email.trim()}>
            Issue a code
          </BtnPrimary>
          {canRevoke && (
            <Tip label="Use this when someone reports a code they did not ask for">
              <BtnGhost icon={ShieldOff} onClick={revoke} disabled={busy || !email.trim()}>
                Kill live codes
              </BtnGhost>
            </Tip>
          )}
          <Muted>Confirm who you are speaking to before issuing anything.</Muted>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3" style={{ background: P.brickWash, border: `1px solid ${alpha(P.brick, 0.4)}`, borderRadius: 8 }} role="alert">
          <TriangleAlert size={15} color={P.brick} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, color: P.inkSoft }}>{error}</span>
        </div>
      )}
      {notice && (
        <div className="p-3" style={{ background: P.greenWash, border: `1px solid ${alpha(P.green, 0.4)}`, borderRadius: 8 }} role="status">
          <span style={{ fontSize: 13, color: P.inkSoft }}>{notice}</span>
        </div>
      )}

      {issued && (
        <div className="p-4 ao-rise" style={{ background: P.card, border: `1px solid ${P.petrol}`, borderRadius: 12 }}>
          <div className="ao-disp uppercase tracking-wide font-semibold" style={{ fontSize: 10.5, letterSpacing: 0.9, color: P.sub }}>
            Read this to {issued.user.name}
          </div>
          <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 8 }}>
            <span className="ao-mono font-semibold" style={{ fontSize: 32, letterSpacing: 4, color: P.ink }}>
              {issued.code}
            </span>
            <BtnGhost
              icon={copied ? Check : Copy}
              onClick={() => {
                navigator.clipboard?.writeText(issued.code);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </BtnGhost>
          </div>
          <div style={{ fontSize: 12.5, color: P.inkSoft, marginTop: 8, lineHeight: 1.55 }}>
            Valid for {issued.expiresInMinutes} minutes, once. {DELIVERY.itIssued.itAction}
          </div>
          <div style={{ fontSize: 12, color: P.sub, marginTop: 6 }}>
            They enter it at the sign-in screen under &ldquo;Forgotten your password?&rdquo; along with the new password
            they choose. It expires in {CODE_TTL_MINUTES} minutes whether or not they use it.
          </div>
        </div>
      )}
    </div>
  );
}

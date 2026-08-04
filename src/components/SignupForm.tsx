"use client";

/* The joining form.

   Two steps, and the split is not decoration. Step one is the joining code,
   which is what turns an anonymous visitor into someone HR has heard of — and
   until it is right there is no manager list to show, because the manager list
   is an org chart and the code is what stands in front of it.

   Step two is the form proper. It validates with the same module the server
   validates with, so the applicant is told about the problem while they are
   looking at the field rather than after they have pressed the button. They
   have no account and nobody to ask; a refusal that does not say what to fix
   leaves them stuck for good. */

import { useState, type FormEvent } from "react";
import { UserPlus, Eye, EyeOff, KeyRound, ArrowRight, CircleCheck } from "lucide-react";
import Link from "next/link";
import { GlassCard, GlassButton, GlassInput, GlassLabel, GlassSelect } from "@/components/glass";
import Logo from "@/components/Logo";
import { BRAND } from "@/lib/brand";
import { checkSignup } from "@/lib/signup.js";

type Manager = { id: string; name: string; jobTitle: string; account: string };

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <GlassLabel>{label}</GlassLabel>
    {children}
  </div>
);

export default function SignupForm({ open }: { open: boolean }) {
  const [code, setCode] = useState("");
  const [managers, setManagers] = useState<Manager[] | null>(null);
  const [domains, setDomains] = useState<string[]>([]);
  const [form, setForm] = useState({
    fullNameEn: "", fullNameAr: "", email: "", password: "", confirm: "",
    phone: "", birthDate: "", jobTitle: "", managerId: "",
  });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/signup/managers?code=${encodeURIComponent(code)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "That did not work.");
      setManagers(j.managers ?? []);
      setDomains(j.domains ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, code }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "That did not work.");
      setDone(j.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  /* Same function the route calls. The browser copy exists to be helpful, not
     to be the authority — the server runs it again against a manager list the
     browser never saw. */
  const { problems, warnings } = checkSignup(form, {
    managers: managers ?? [],
    domains,
    today: new Date().toISOString().slice(0, 10),
  });

  const shell = (children: React.ReactNode) => (
    <div className="w-full max-w-lg">
      <div className="mb-6 flex justify-center">
        <Logo size={40} subtitle={`${BRAND.org} · ${BRAND.promise}`} />
      </div>
      <GlassCard glow="violet" className="gradient-hairline">{children}</GlassCard>
      <p className="mt-4 text-center text-[12.5px] text-[color:var(--sub)]">
        Already have an account? <Link href="/login" className="text-[color:var(--signal)] underline">Sign in</Link>
      </p>
    </div>
  );

  if (!open) {
    return shell(
      <div className="grid gap-3">
        <h1 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-[color:var(--ink)]">
          <UserPlus size={15} className="text-[color:var(--signal)]" />
          Joining
        </h1>
        <p className="text-[13.5px] text-[color:var(--ink-soft)]">
          Self sign-up is not switched on here. Your HR contact can add you directly — ask them for a login.
        </p>
      </div>,
    );
  }

  if (done) {
    return shell(
      <div className="grid gap-3">
        <h1 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-[color:var(--ink)]">
          <CircleCheck size={15} className="text-emerald-400" />
          Application sent
        </h1>
        <p className="text-[13.5px] text-[color:var(--ink-soft)]">{done}</p>
        <Link href="/login">
          <GlassButton className="w-full">Go to sign in</GlassButton>
        </Link>
      </div>,
    );
  }

  /* Step one. */
  if (managers === null) {
    return shell(
      <form onSubmit={unlock} className="grid gap-4">
        <h1 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-[color:var(--ink)]">
          <KeyRound size={15} className="text-[color:var(--signal)]" />
          Joining code
        </h1>
        <p className="text-[13px] text-[color:var(--sub)]">
          It came with your offer. It is not a password — it only opens this form.
        </p>
        <Row label="Code">
          <GlassInput value={code} onChange={(e) => setCode(e.target.value)} autoFocus placeholder="konecta-…" />
        </Row>
        {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-[13px] text-rose-200">{error}</div>}
        <GlassButton type="submit" loading={busy} disabled={!code.trim()}>
          Continue <ArrowRight size={14} />
        </GlassButton>
      </form>,
    );
  }

  /* Step two. */
  return shell(
    <form onSubmit={submit} className="grid gap-4">
      <h1 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-[color:var(--ink)]">
        <UserPlus size={15} className="text-[color:var(--signal)]" />
        Your details
      </h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Full name (English)">
          <GlassInput value={form.fullNameEn} onChange={set("fullNameEn")} autoFocus placeholder="As on your national ID" />
        </Row>
        <Row label="Full name (Arabic)">
          <GlassInput value={form.fullNameAr} onChange={set("fullNameAr")} dir="rtl" />
        </Row>
      </div>

      <Row label={domains.length ? `Email (${domains.join(" or ")})` : "Email you will sign in with"}>
        <GlassInput type="email" value={form.email} onChange={set("email")} autoComplete="username" />
      </Row>

      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Password">
          <div className="relative">
            <GlassInput
              type={show ? "text" : "password"}
              value={form.password}
              onChange={set("password")}
              autoComplete="new-password"
              className="pe-11"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute inset-y-0 end-0 flex items-center px-3 text-[color:var(--sub)]"
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Row>
        <Row label="Password again">
          <GlassInput type={show ? "text" : "password"} value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
        </Row>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Mobile">
          <GlassInput value={form.phone} onChange={set("phone")} inputMode="tel" placeholder="01x xxxx xxxx" />
        </Row>
        <Row label="Date of birth">
          <GlassInput type="date" value={form.birthDate} onChange={set("birthDate")} />
        </Row>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Row label="Role you are joining as">
          <GlassInput value={form.jobTitle} onChange={set("jobTitle")} placeholder="Customer Service Agent" />
        </Row>
        <Row label="Your manager">
          <GlassSelect value={form.managerId} onChange={set("managerId")}>
            <option value="">Choose…</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.jobTitle ? ` — ${m.jobTitle}` : ""}{m.account ? ` · ${m.account}` : ""}
              </option>
            ))}
          </GlassSelect>
        </Row>
      </div>

      {/* Said while they are still looking at the field. */}
      {problems.length > 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-[13px] text-amber-200">
          {problems[0]}
        </div>
      )}
      {problems.length === 0 && warnings.length > 0 && (
        <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--mist)] p-3 text-[13px] text-[color:var(--ink-soft)]">
          {warnings[0]}
        </div>
      )}
      {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-[13px] text-rose-200">{error}</div>}

      <GlassButton type="submit" loading={busy} disabled={problems.length > 0}>
        Send to my manager
      </GlassButton>
      <p className="text-[12px] text-[color:var(--sub)]">
        Nothing is created until your manager approves this. You will not be able to sign in until they do.
      </p>
    </form>,
  );
}

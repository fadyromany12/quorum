"use client";

/* Forced first-login password change. The server layouts redirect here while
   session.mustChange is true; on success we update the JWT in place and go to
   the role home. */

import { useState, type FormEvent } from "react";
import { useSession, signOut } from "next-auth/react";
import { SessionProvider } from "next-auth/react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { GlassCard, GlassButton, GlassInput, GlassLabel } from "@/components/glass";
import { passwordProblem } from "@/lib/auth.js";

function ChangePasswordInner() {
  const { data: session, update } = useSession();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(pw.trim());
    if (problem) return setError(problem);
    if (pw.trim() !== confirm.trim()) return setError("The two entries don't match.");
    setBusy(true);
    setError("");
    const res = await fetch("/api/users/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw.trim() }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not change the password.");
      setBusy(false);
      return;
    }
    await update({ mustChange: false });
    window.location.href = "/";
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <GlassCard glow="amber">
          <form onSubmit={submit} className="grid gap-4">
            <h1 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-slate-200">
              <KeyRound size={15} className="text-amber-300" />
              Set a new password
            </h1>
            <p className="text-[12.5px] text-slate-400">
              Welcome{session?.user?.name ? `, ${session.user.name}` : ""}. You're signed in with the default
              password — choose your own before continuing.
            </p>
            <div>
              <GlassLabel>New password</GlassLabel>
              <GlassInput type="password" autoFocus autoComplete="new-password" value={pw} onChange={(e) => { setPw(e.target.value); setError(""); }} />
              <p className="mt-1 text-[11px] text-slate-500">At least 8 characters, with an uppercase letter, a lowercase letter and a number.</p>
            </div>
            <div>
              <GlassLabel>Repeat it</GlassLabel>
              <GlassInput type="password" autoComplete="new-password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(""); }} />
            </div>
            {error && (
              <p role="alert" className="text-[12.5px] text-rose-300">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-3">
              <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="text-[12.5px] text-slate-500 hover:text-slate-300">
                Sign out
              </button>
              <GlassButton type="submit" loading={busy}>
                <ShieldCheck size={14} />
                Save &amp; continue
              </GlassButton>
            </div>
          </form>
        </GlassCard>
      </div>
    </main>
  );
}

export default function ChangePasswordPage() {
  return (
    <SessionProvider>
      <ChangePasswordInner />
    </SessionProvider>
  );
}

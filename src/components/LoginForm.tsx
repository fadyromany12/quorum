"use client";

/* The credentials form. Locale comes from the server page so the first paint is
   already in the right language and direction. */

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { LogIn, Eye, EyeOff, KeyRound } from "lucide-react";
import { GlassCard, GlassButton, GlassInput, GlassLabel } from "@/components/glass";
import Logo from "@/components/Logo";
import { BRAND } from "@/lib/brand";
import { t } from "@/lib/i18n.js";
import { CODE_TTL_MINUTES, DELIVERY } from "@/lib/reset.js";

export default function LoginForm({ locale }: { locale: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  /* Recovery lives on this screen rather than a separate page. Somebody who
     cannot get in is already here, already frustrated, and a link that
     navigates away loses the address they have just typed. */
  const [mode, setMode] = useState<"signIn" | "recover">("signIn");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");

  const recover = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/reset/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code, password }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "That did not work.");
      setNotice(j.message);
      setMode("signIn");
      setCode("");
      setPassword("");
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
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.error) {
      setError(t(locale, "login.invalid"));
      setBusy(false);
      return;
    }
    window.location.href = "/";
  };

  return (
    <div className="w-full max-w-md">
      <div className="mb-6 flex justify-center">
        <Logo size={40} subtitle={`${BRAND.org} · ${BRAND.promise}`} />
      </div>
      <GlassCard glow="violet" className="gradient-hairline">
        <form onSubmit={mode === "signIn" ? submit : recover} className="grid gap-4">
          <h1 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-[color:var(--ink)]">
            <LogIn size={15} className="text-[color:var(--signal)]" />
            {t(locale, "login.signIn")}
          </h1>
          <div>
            <GlassLabel>{t(locale, "login.email")}</GlassLabel>
            <GlassInput
              type="email"
              autoFocus
              autoComplete="username"
              placeholder="name@konecta.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
            />
          </div>
          {mode === "recover" && (
            <div>
              <GlassLabel>Recovery code</GlassLabel>
              <GlassInput
                autoComplete="one-time-code"
                placeholder="ABCD-2345"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setError("");
                }}
              />
            </div>
          )}
          <div>
            <GlassLabel>{mode === "signIn" ? t(locale, "login.password") : "New password"}</GlassLabel>
            <div className="relative">
              <GlassInput
                type={show ? "text" : "password"}
                autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                placeholder="••••••••"
                className="pr-11"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? t(locale, "login.hidePw") : t(locale, "login.showPw")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--sub)] hover:text-[color:var(--ink)] rtl:right-auto rtl:left-3"
              >
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-[12.5px] text-[color:var(--brick)]">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-[12.5px] text-[color:var(--green)]">
              {notice}
            </p>
          )}
          <GlassButton type="submit" loading={busy}>
            {mode === "signIn" ? t(locale, "login.signIn") : "Set password"}
          </GlassButton>

          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === "signIn" ? "recover" : "signIn"));
              setError("");
              setNotice("");
            }}
            className="text-[12px] underline-offset-2 hover:underline text-[color:var(--sub)]"
          >
            {mode === "signIn" ? "Forgotten your password?" : "Back to signing in"}
          </button>
        </form>
      </GlassCard>
      <p className="mt-4 text-center text-[11.5px] text-[color:var(--sub)]">{t(locale, "login.provisioned")}</p>
    </div>
  );
}

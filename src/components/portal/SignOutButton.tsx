"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import Tip from "@/components/ui/Tip";

export default function SignOutButton() {
  return (
    <Tip label="Sign out" side="bottom">
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        aria-label="Sign out"
        className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-400 backdrop-blur-md transition hover:bg-white/10 hover:text-slate-200"
      >
        <LogOut size={14} />
      </button>
    </Tip>
  );
}

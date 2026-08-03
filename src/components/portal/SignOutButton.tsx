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
        className="rounded-xl border border-[color:var(--line)] bg-[color:var(--mist)] p-2 text-[color:var(--sub)] backdrop-blur-md transition hover:bg-[color:var(--mist)] hover:text-[color:var(--ink)]"
      >
        <LogOut size={14} />
      </button>
    </Tip>
  );
}

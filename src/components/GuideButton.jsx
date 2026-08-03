"use client";

/* The guide's control and the guide itself, kept together.

   Both the workspace and the agent portal want the same thing — a button in the
   header, a dialog that opens itself on the first visit — and splitting the
   state across two call sites is how one of them ends up never auto-opening.
   The portal's header is a server component, which is another reason for the
   client boundary to live here rather than there. */

import { Compass } from "lucide-react";

import Tip from "./ui/Tip.jsx";
import GuideDialog from "./GuideDialog.jsx";
import { useGuide } from "../hooks/useGuide.js";

export default function GuideButton({ role, side = "bottom", label = "Guide" }) {
  const guide = useGuide(role);
  return (
    <>
      <Tip label="What you can do here" side={side}>
        <button
          type="button"
          onClick={guide.show}
          aria-label="What you can do here"
          className="ao-glow inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition"
          style={{ borderColor: "var(--line)", background: "var(--card)", color: "var(--ink-soft)", cursor: "pointer" }}
        >
          <Compass size={13} />
          {label ? <span className="hidden sm:inline">{label}</span> : null}
        </button>
      </Tip>
      <GuideDialog role={role} open={guide.open} onClose={guide.close} />
    </>
  );
}

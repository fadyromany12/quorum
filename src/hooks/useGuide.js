"use client";

/* Whether to show the role guide, and remembering that you have seen it.

   Three judgements are baked in:

     1. It opens once per role per guide version, not once ever. Someone
        promoted from Agent to Operations Lead is looking at a different app,
        and their old dismissal should not hide it.

     2. If localStorage is unavailable — private mode, a locked-down browser,
        storage disabled — the guide does *not* open. A dialog that cannot
        remember being dismissed is a dialog that appears on every single page
        load, which turns a helpful thing into a thing people learn to click
        past without reading.

     3. It waits a beat. Opening a modal in the same frame the workspace is
        still animating in reads as a crash; a short delay lets the page settle
        first, and the guide arrives as a greeting rather than an interruption. */

import { useCallback, useEffect, useState } from "react";
import { guideKey } from "../lib/guide.js";

const SETTLE_MS = 650;

const seen = (key) => {
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return true; // cannot remember → never nag
  }
};

const remember = (key) => {
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    /* nothing to do — worst case it opens again next time storage works */
  }
};

export function useGuide(role) {
  const [open, setOpen] = useState(false);
  const key = guideKey(role);

  useEffect(() => {
    if (seen(key)) return;
    const t = setTimeout(() => setOpen(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [key]);

  const close = useCallback(() => {
    setOpen(false);
    remember(key);
  }, [key]);

  // Reopening on demand also counts as having seen it.
  const show = useCallback(() => {
    remember(key);
    setOpen(true);
  }, [key]);

  return { open, show, close };
}

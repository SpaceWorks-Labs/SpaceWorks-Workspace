"use client";

import { useEffect, useRef, useState } from "react";

/** Copies the installer command; the label itself announces the result. */
export function CopyCommand({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  const copy = async () => {
    clearTimeout(reset.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    reset.current = setTimeout(() => setState("idle"), 2000);
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-live="polite"
      className={`min-h-11 rounded-md border px-3 text-label font-medium transition-colors duration-[var(--sw-dur-fast)] ${state === "copied" ? "border-sw-citron bg-sw-citron text-sw-ink" : "border-line-strong text-on-inverse hover:border-sw-citron hover:bg-sw-citron hover:text-sw-ink"}`}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy below" : "Copy command"}
    </button>
  );
}

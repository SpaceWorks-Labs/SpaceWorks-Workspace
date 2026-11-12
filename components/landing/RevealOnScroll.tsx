"use client";

import { useEffect } from "react";

/**
 * Scroll reveals that only enhance: every `[data-reveal]` block renders
 * visible. After hydration, blocks still below the fold are marked "waiting"
 * (faded and lowered by a token distance) and shown as they enter the
 * viewport. Reduced motion, or no IntersectionObserver, leaves them alone.
 */
export function RevealOnScroll() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const blocks = [...document.querySelectorAll<HTMLElement>("[data-reveal]")].filter((block) => block.getBoundingClientRect().top > innerHeight);
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.reveal = "shown";
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -10% 0px" });
    for (const block of blocks) { block.dataset.reveal = "waiting"; observer.observe(block); }
    // Keyboard users tabbing into a waiting block see it straight away.
    const onFocus = (event: FocusEvent) => { const block = (event.target as Element).closest?.<HTMLElement>("[data-reveal='waiting']"); if (block) block.dataset.reveal = "shown"; };
    document.addEventListener("focusin", onFocus);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", onFocus);
      for (const block of blocks) block.dataset.reveal = "";
    };
  }, []);
  return null;
}

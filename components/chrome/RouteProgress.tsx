"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Wait this long before showing the bar, so instant navigations never flash it. */
const SHOW_AFTER_MS = 150;
/** Give up if a navigation never reports back (cancelled, error page). */
const GIVE_UP_MS = 8000;

/**
 * Thin top progress bar for client navigations. A click on an internal link
 * (that Next's Link did not cancel) arms it; a new pathname or query clears it.
 * Never blocks input (pointer-events none); still under reduced motion.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = pathname + "?" + search;
  // `from` is the route the click left; the navigation is done once `here` differs.
  const [armed, setArmed] = useState<{ from: string; shown: boolean } | null>(null);
  const pending = armed !== null && armed.from === here;

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!event.defaultPrevented) return; // Link handles it client-side; plain anchors reload the page.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || url.pathname + url.search === location.pathname + location.search) return;
      setArmed({ from: location.pathname + "?" + new URLSearchParams(location.search).toString(), shown: false });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // A finished navigation disarms the bar so returning to `from` later cannot revive it.
  useEffect(() => {
    const done = setTimeout(() => setArmed(null), 0);
    return () => clearTimeout(done);
  }, [here]);

  useEffect(() => {
    if (!pending) return;
    const show = setTimeout(() => setArmed((current) => (current ? { ...current, shown: true } : current)), SHOW_AFTER_MS);
    const giveUp = setTimeout(() => setArmed(null), GIVE_UP_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(giveUp);
    };
  }, [pending]);

  if (!pending || !armed.shown) return null;
  return (
    <div role="progressbar" aria-label="Loading page" aria-busy="true" className="sw-fade-in pointer-events-none fixed inset-x-0 top-0 z-[90] h-0.5 overflow-hidden bg-accent-soft">
      <div className="sw-progress-bar h-full w-2/5 bg-primary" />
    </div>
  );
}

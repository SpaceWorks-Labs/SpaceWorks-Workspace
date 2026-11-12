"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { BOX_OPEN_SVG } from "./boxOpenMarkup";

/** One hover cycle (`.sw-box.hov`): fold shut 600ms, then the 1600ms opening. */
const HOVER_MS = 2200;

/** Where the 136 x 126 symbol sits inside each master's viewBox (lockups draw it from the origin). */
export const SYMBOL_BOX = {
  symbol: { w: 136, h: 126, vw: 136, vh: 126 },
  "lockup-stacked": { w: 136 * 1.0084, h: 126 * 1.0084, vw: 360, vh: 128 },
  "lockup-horizontal": { w: 136 * 0.45714, h: 57.6, vw: 360, vh: 58 },
} as const;

const reduced = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const focusVisible = (target: EventTarget | null) => { try { return target instanceof Element && target.matches(":focus-visible"); } catch { return false; } };

/**
 * The Space Works mark opens on hover and keyboard focus (Design System 0.12.0,
 * motion/box-open): from the resting logo the box folds shut and opens back
 * (2200ms, once). Starts on pointer-enter (mouse or pen, never touch) or
 * focus-visible of the host link or button; once started it always finishes and
 * re-entering does not restart it. Reduced motion never starts it. Mounted over
 * the symbol part of the mark only while playing; the mark's `img` hides that
 * column meanwhile (`[data-logo-playing]` in global-elements.css), so nothing
 * shifts. `ground` forces the artwork for a surface that never changes with the
 * colour mode.
 */
export function LogoBoxOverlay({ width, height, offset, ground }: {
  width: number; height: number; offset: number; ground?: "dark" | "light";
}) {
  const root = useRef<HTMLSpanElement>(null);
  const running = useRef(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const overlay = root.current;
    const mark = overlay?.parentElement;
    if (!overlay || !mark) return;
    const host = mark.closest("a, button") ?? mark;
    const start = () => { if (!running.current && !reduced()) { running.current = true; setPlaying(true); } };
    const onEnter = (event: Event) => { if ((event as PointerEvent).pointerType !== "touch") start(); };
    const onFocus = (event: Event) => { if (focusVisible(event.target)) start(); };
    const onEnd = (event: Event) => { if ((event as AnimationEvent).animationName === "sw-boxh-w") { running.current = false; setPlaying(false); } };
    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("focusin", onFocus);
    overlay.addEventListener("animationend", onEnd);
    return () => {
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("focusin", onFocus);
      overlay.removeEventListener("animationend", onEnd);
    };
  }, []);

  useEffect(() => {
    const mark = root.current?.parentElement;
    if (!playing || !mark) return;
    mark.setAttribute("data-logo-playing", "");
    // Safety net if no animationend arrives (tab hidden mid-cycle).
    const timer = window.setTimeout(() => { running.current = false; setPlaying(false); }, HOVER_MS + 250);
    return () => { window.clearTimeout(timer); mark.removeAttribute("data-logo-playing"); };
  }, [playing]);

  return (
    <span ref={root} aria-hidden="true" className="sw-logo-box" style={{ left: offset, top: offset, width, height }}>
      {playing ? (
        <span className={cn("sw-box hov", ground === "dark" && "g-dark", ground === "light" && "g-light")} dangerouslySetInnerHTML={{ __html: BOX_OPEN_SVG }} />
      ) : null}
    </span>
  );
}

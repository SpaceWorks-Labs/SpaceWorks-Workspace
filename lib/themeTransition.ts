// Light/dark switch animation (Design System 0.12.0, motion/theme-reveal). Browser-only:
// called from the colour-mode toggle in components/providers.tsx; the CSS is
// app/styles/theme-reveal.css, synced from the kit by `npm run tokens:sync`.
// With View Transitions the new mode grows from the toggle as a circle (soft-edged
// where a registered custom property can animate inside a mask); without them every
// colour cross-fades; reduced motion switches instantly. The mode is always applied,
// even when an animation API is missing or throws: the reveal is decoration.

export type RevealOrigin = { x: number; y: number };

const FEATHER = 160;
const TIMING = { duration: 720, easing: "cubic-bezier(0.45, 0, 0.2, 1)" } as const;
/** The fallback cross-fade runs 420ms; the class stays a little longer so nothing snaps. */
const FADE_HOLD_MS = 460;

type ViewTransition = { ready: Promise<void>; finished: Promise<void> };
type TransitionDocument = Document & { startViewTransition?: (update: () => void) => ViewTransition };

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function supportsFeather() {
  return typeof CSS !== "undefined" && typeof CSS.registerProperty === "function"
    && CSS.supports?.("mask-image", "radial-gradient(circle, currentColor, transparent)") === true;
}

/** `commit` applies the new mode (tokens and React state) synchronously. */
export function transitionColorMode(commit: () => void, origin?: RevealOrigin) {
  if (prefersReducedMotion()) { commit(); return; }
  const root = document.documentElement;
  const doc = document as TransitionDocument;
  if (typeof doc.startViewTransition !== "function") {
    root.classList.add("sw-theme-fade");
    commit();
    window.setTimeout(() => root.classList.remove("sw-theme-fade"), FADE_HOLD_MS);
    return;
  }

  const x = origin?.x ?? window.innerWidth - 40;
  const y = origin?.y ?? 32;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + FEATHER;
  const feathered = supportsFeather();
  root.style.setProperty("--sw-reveal-x", `${x}px`);
  root.style.setProperty("--sw-reveal-y", `${y}px`);
  root.classList.add(feathered ? "sw-theme-reveal-soft" : "sw-theme-reveal");
  const cleanUp = () => {
    root.classList.remove("sw-theme-reveal", "sw-theme-reveal-soft");
    root.style.removeProperty("--sw-reveal-x");
    root.style.removeProperty("--sw-reveal-y");
  };

  let applied = false;
  const apply = () => { applied = true; commit(); };
  const recover = () => { if (!applied) apply(); cleanUp(); };
  try {
    const transition = doc.startViewTransition(apply);
    transition.ready.then(() => {
      // fill: "forwards" holds the final frame; without it the mask snaps back for one
      // frame before the transition tears down, flashing the old mode.
      root.animate?.(
        feathered
          ? { "--sw-reveal": ["0px", `${radius}px`] }
          : { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { ...TIMING, fill: "forwards", pseudoElement: "::view-transition-new(root)" },
      );
    }).catch(recover);
    transition.finished.then(cleanUp, recover);
  } catch {
    recover();
  }
}

/**
 * Browser chrome follows the painted canvas (Warm Cream light, black dark). The
 * server metadata follows the OS; an explicit choice repaints both theme-color tags.
 */
export function syncThemeColorMeta() {
  const canvas = getComputedStyle(document.documentElement).getPropertyValue("--yy-bg-canvas").trim();
  if (!canvas) return;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = canvas;
}

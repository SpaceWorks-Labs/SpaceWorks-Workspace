"use client";

import { useEffect, useRef, type ReactNode } from "react";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };

type Geometry = { start: number; rest: number; distance: number; scale: number };

/**
 * The hero scene: the copy lifts away, the product preview rises onto a sky
 * backdrop, zooms through its content surface and hands over to the first
 * section. Scroll-driven and sticky; without script, with reduced motion or on
 * a viewport too short for it, the three parts simply stack.
 */
export function HeroSequence({ copy, preview, story }: { copy: ReactNode; preview: ReactNode; story: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sequence = root.current;
    if (!sequence) return;
    const pick = (name: string) => sequence.querySelector<HTMLElement>(`[data-hero="${name}"]`)!;
    const [scene, copyEl, panel, frame, backdrop, storyEl] = ["scene", "copy", "panel", "frame", "backdrop", "story"].map(pick);
    const figure = frame.firstElementChild as HTMLElement;
    const content = sequence.querySelector<HTMLElement>("[data-zoom-target]")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const parts = [copyEl, panel, frame, figure, backdrop, storyEl];
    let geometry: Geometry | null = null;
    let last: number | null = null;
    let frameId = 0;

    const paint = () => {
      frameId = 0;
      if (!geometry) return;
      const progress = clamp(-sequence.getBoundingClientRect().top / geometry.distance);
      if (progress === last) return;
      last = progress;
      const rise = ease(progress / 0.38);
      const zoom = ease((progress - 0.55) / 0.29);
      const reveal = ease((progress - 0.86) / 0.14);
      const fade = clamp(progress / 0.25);
      copyEl.style.transform = `translateY(${-90 * fade}px)`;
      copyEl.style.opacity = String(1 - fade);
      copyEl.inert = fade === 1;
      panel.style.transform = `translateY(${geometry.start + (geometry.rest - geometry.start) * rise}px)`;
      frame.style.transform = `scale(${1 + (geometry.scale - 1) * zoom})`;
      figure.style.opacity = String(1 - ease((progress - 0.7) / 0.14));
      panel.inert = zoom > 0.5;
      storyEl.style.opacity = String(reveal);
      storyEl.style.transform = `translateY(${32 * (1 - reveal)}px) scale(${0.94 + 0.06 * reveal})`;
      storyEl.inert = reveal === 0;
      backdrop.style.opacity = String(rise);
    };
    const schedule = () => { if (geometry && !frameId) frameId = requestAnimationFrame(paint); };

    const measure = () => {
      last = null;
      const height = innerHeight;
      const header = document.querySelector<HTMLElement>("[data-landing-header]")?.offsetHeight ?? 0;
      let enabled = !reduced.matches && height > copyEl.offsetHeight + header + 140;
      sequence.classList.toggle("is-animated", enabled);
      if (enabled && (storyEl.scrollHeight > height + 2 || frame.offsetHeight > height - 48)) enabled = false;
      sequence.classList.toggle("is-animated", enabled);
      if (!enabled) {
        geometry = null;
        sequence.style.removeProperty("--copy-top");
        sequence.style.removeProperty("--preview-start");
        for (const part of parts) { part.removeAttribute("style"); part.inert = false; }
        return;
      }
      const start = height - header - 116;
      sequence.style.setProperty("--copy-top", `${Math.max(24, (start - copyEl.offsetHeight) / 2)}px`);
      sequence.style.setProperty("--preview-start", `${start}px`);
      const centerX = frame.offsetWidth / 2;
      const centerY = frame.offsetHeight / 2;
      const halfWidth = Math.min(centerX - content.offsetLeft, content.offsetLeft + content.offsetWidth - centerX);
      const halfHeight = Math.min(centerY - content.offsetTop, content.offsetTop + content.offsetHeight - centerY);
      geometry = {
        start,
        rest: (height - frame.offsetHeight) / 2,
        distance: sequence.offsetHeight - scene.offsetHeight,
        scale: Math.max(innerWidth / (2 * halfWidth), height / (2 * halfHeight)) * 1.06,
      };
      paint();
    };

    // "Features" links land where the first section has fully arrived.
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href="#features"]');
      if (!link || !geometry) return;
      event.preventDefault();
      scrollTo({ top: scrollY + sequence.getBoundingClientRect().top + geometry.distance, behavior: "smooth" });
      storyEl.focus({ preventScroll: true });
    };

    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", measure);
    reduced.addEventListener("change", measure);
    document.addEventListener("click", onClick);
    let live = true;
    void document.fonts?.ready.then(() => { if (live) measure(); });
    measure();
    return () => {
      live = false;
      removeEventListener("scroll", schedule);
      removeEventListener("resize", measure);
      reduced.removeEventListener("change", measure);
      document.removeEventListener("click", onClick);
      if (frameId) cancelAnimationFrame(frameId);
      sequence.classList.remove("is-animated");
      for (const part of parts) { part.removeAttribute("style"); part.inert = false; }
    };
  }, []);

  return (
    <div ref={root} className="landing-sequence bg-canvas text-ink">
      <div data-hero="scene" className="landing-scene">
        <div data-hero="backdrop" className="landing-backdrop" aria-hidden />
        <section className="landing-hero landing-pattern" aria-labelledby="landing-hero-title">
          <div className="landing-wrap landing-wrap-narrow">
            <div data-hero="copy" className="landing-hero-copy mx-auto max-w-[900px] text-center">{copy}</div>
          </div>
        </section>
        <div data-hero="panel" className="landing-product">
          <div className="landing-wrap landing-wrap-narrow">
            <div data-hero="frame" className="landing-viewport overflow-hidden rounded-lg border border-line bg-panel">{preview}</div>
          </div>
        </div>
        <section id="features" data-hero="story" tabIndex={-1} className="landing-story landing-section focus:outline-none" aria-labelledby="landing-story-title">
          {story}
        </section>
      </div>
    </div>
  );
}

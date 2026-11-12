"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { SpaceWorksWorkspaceLogo } from "@/components/brand/SpaceWorksLogo";
import { ColorModeToggle } from "@/components/chrome/ColorModeToggle";
import { NAV_LINKS, REPO_URL } from "@/components/landing/content";

const linkClass = "rounded-md py-3 hover:underline hover:underline-offset-[6px]";

/** The top bar: lockup, section links, colour mode and Sign in. Not sticky, like the Labs site. */
export function LandingHeader({ allowSignup }: { allowSignup: boolean }) {
  const menu = useRef<HTMLDetailsElement>(null);

  // Close the mobile menu on Escape (focus back on its button) or a click outside it.
  useEffect(() => {
    const details = menu.current;
    if (!details) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && details.open) { details.open = false; details.querySelector("summary")?.focus(); }
    };
    const onPointer = (event: PointerEvent) => { if (details.open && !details.contains(event.target as Node)) details.open = false; };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); };
  }, []);

  return (
    <header data-landing-header className="border-b border-line bg-canvas text-ink">
      <div className="landing-wrap landing-wrap-narrow flex min-h-[var(--landing-header)] items-center justify-between gap-2 sm:gap-4">
        <Link href="/" aria-label="Space Works Workspace home" className="inline-flex rounded-md py-3">
          <SpaceWorksWorkspaceLogo height={32} label={null} />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2 md:gap-5">
          <div className="hidden items-center gap-6 text-label md:flex">
            {NAV_LINKS.map((link) => <a key={link.href} href={link.href} className={linkClass}>{link.label}</a>)}
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>GitHub<span className="sr-only"> (opens in a new tab)</span></a>
          </div>
          <div className="hidden md:block"><ColorModeToggle /></div>
          <Link href="/login" className="inline-flex min-h-11 items-center gap-3 whitespace-nowrap rounded-md bg-inverse px-4 text-label font-semibold text-on-inverse transition-colors duration-[var(--sw-dur-fast)] hover:bg-primary hover:text-on-primary dark:bg-sw-cream dark:text-sw-ink dark:hover:bg-primary dark:hover:text-on-primary">
            Sign in <ArrowUpRight aria-hidden className="hidden size-4 sm:block" />
          </Link>
          <details ref={menu} className="landing-menu relative md:hidden">
            <summary className="flex min-h-11 cursor-pointer items-center rounded-md px-2 text-label font-medium">Menu</summary>
            <div className="absolute right-0 top-[calc(100%+8px)] z-20 grid w-56 rounded-lg border border-line bg-panel p-2 shadow-float" onClick={(event) => { if ((event.target as Element).closest("a")) menu.current!.open = false; }}>
              {NAV_LINKS.map((link) => <a key={link.href} href={link.href} className="rounded-md px-3 py-2.5 text-body-ui hover:bg-muted">{link.label}</a>)}
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="rounded-md px-3 py-2.5 text-body-ui hover:bg-muted">GitHub<span className="sr-only"> (opens in a new tab)</span></a>
              {allowSignup ? <Link href="/signup" className="rounded-md px-3 py-2.5 text-body-ui hover:bg-muted">Create account</Link> : null}
              <div className="mt-1 flex items-center justify-between border-t border-line pt-1 pl-3 text-body-ui">Appearance <ColorModeToggle /></div>
            </div>
          </details>
        </nav>
      </div>
    </header>
  );
}

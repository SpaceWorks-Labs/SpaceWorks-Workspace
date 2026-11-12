import type { ReactNode } from "react";
import Link from "next/link";
import { Patch } from "@/components/brand/Patch";
import { SpaceWorksLogo, SpaceWorksWorkspaceLogo } from "@/components/brand/SpaceWorksLogo";

/**
 * Split layout for sign-in, setup, invitation and password pages: the form on
 * the left, a calm brand panel on the right (desktop only). Patch supplies the
 * single bold moment; the accompanying copy stays in Outfit.
 */
export function AuthFrame({ title, description, children, accent = "Make things\ntogether.", centered = false }: { title: ReactNode; description?: ReactNode; children: ReactNode; accent?: string; centered?: boolean }) {
  if (centered) return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="px-4 py-4 sm:px-8"><Link href="/" aria-label="Space Works Workspace home" className="inline-flex rounded-md"><SpaceWorksLogo variant="symbol" label={null} /></Link></header>
      <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center px-4 py-8 focus:outline-none">
        <div data-page-layout="centered-card" className="w-full max-w-[480px] space-y-6 rounded-xl border border-line bg-panel p-5 sm:p-8">
          <div className="space-y-2"><h1 className="text-h1">{title}</h1>{description ? <p className="text-body text-ink-secondary">{description}</p> : null}</div>
          {children}
        </div>
      </main>
    </div>
  );
  return (
    <div className="grid min-h-dvh bg-canvas md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-4 py-5 sm:px-8 sm:py-6">
        <header>
          <Link href="/" aria-label="Space Works Workspace home" className="inline-flex rounded-md">
            <SpaceWorksWorkspaceLogo height={32} label={null} />
          </Link>
        </header>
        <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center py-10 focus:outline-none">
          <div className="flex w-full max-w-[420px] flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-display-l text-ink">{title}</h1>
              {description ? <p className="text-body-ui text-ink-secondary">{description}</p> : null}
            </div>
            {children}
          </div>
        </main>
      </div>
      <aside aria-hidden className="relative hidden overflow-hidden p-4 md:block">
        <div className="relative flex h-full flex-col justify-between gap-10 overflow-hidden rounded-xl bg-surface p-8 xl:p-12">
          <SpaceWorksLogo variant="lockup-stacked" height={88} className="self-start" />
          <div className="relative flex flex-col gap-3 py-6">
            <span className="relative max-w-[320px] rounded-xl border border-line bg-panel p-4 text-label text-ink">#build-night · Soldering the LED wall tonight</span>
            <span className="relative ml-12 max-w-[320px] rounded-xl border border-line bg-panel p-4 text-label text-ink">BOT-12 · Motor driver board moved to Review</span>
            <span className="relative ml-4 inline-flex items-center gap-2 self-start rounded-full bg-sw-citron px-4 py-2 text-label text-sw-ink">Meera shared the 3D print notes</span>
          </div>
          <div className="relative flex flex-col items-start gap-4">
            <Patch size={128} />
            <p className="whitespace-pre-line text-h1 text-ink">{accent}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

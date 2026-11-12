import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SpaceWorksWorkspaceLogo } from "@/components/brand/SpaceWorksLogo";
import { NAV_LINKS, RELEASE, REPO_URL } from "@/components/landing/content";
import { PROJECT_LINKS } from "@/components/landing/content-docs";

const footLink = "inline-flex min-h-11 items-center rounded-md hover:underline hover:underline-offset-[5px]";

/** Citron colophon with the closing GitHub call, as on the Labs site; a quiet surface in dark mode. */
export function LandingFooter({ allowSignup }: { allowSignup: boolean }) {
  return (
    <footer className="landing-citron bg-sw-citron pt-12 pb-7 text-sw-ink dark:bg-surface dark:text-ink">
      <div className="landing-wrap grid items-center gap-6 border-b border-current/25 pb-8 text-center md:grid-cols-[1fr_auto] md:gap-11 md:text-left">
        <div>
          <p className="mb-3 text-label">Free and open source. Built by a maker community.</p>
          <h2 className="font-display text-[2.2rem] font-extrabold leading-[1.08] tracking-[-0.035em] md:text-[3.5rem]">Run it your way.</h2>
        </div>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center gap-4 justify-self-center rounded-md bg-sw-ink px-6 font-semibold text-sw-cream transition-colors duration-[var(--sw-dur-fast)] hover:bg-primary hover:text-on-primary md:justify-self-end dark:bg-sw-cream dark:text-sw-ink dark:hover:bg-primary dark:hover:text-on-primary">
          View on GitHub <ArrowUpRight aria-hidden className="size-5" /><span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <div className="landing-wrap mt-5 flex flex-wrap items-center gap-x-10 gap-y-4">
        <Link href="/" aria-label="Space Works Workspace home" className="inline-flex rounded-md py-2">
          <SpaceWorksWorkspaceLogo height={36} label={null} />
        </Link>
        <nav aria-label="This workspace" className="flex flex-wrap gap-x-6 text-label md:ml-auto">
          <Link href="/login" className={footLink}>Sign in</Link>
          {allowSignup ? <Link href="/signup" className={footLink}>Create account</Link> : null}
          {NAV_LINKS.map((link) => <a key={link.href} href={link.href} className={footLink}>{link.label}</a>)}
        </nav>
        <nav aria-label="Project" className="flex flex-wrap gap-x-6 text-label">
          {PROJECT_LINKS.map((link) => (
            <a key={link.title} href={link.href} target="_blank" rel="noopener noreferrer" className={footLink}>{link.title}<span className="sr-only"> (opens in a new tab)</span></a>
          ))}
        </nav>
        <p className="code-text order-last w-full text-caption tabular-nums">
          Space Works Workspace {RELEASE.version} · released {RELEASE.date} · AGPL-3.0-or-later · made by Space Works, a maker community that started inside TinkerSpace Kochi
        </p>
      </div>
    </footer>
  );
}

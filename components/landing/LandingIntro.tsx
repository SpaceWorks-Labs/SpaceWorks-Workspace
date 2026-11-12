import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { RELEASE, repoFile } from "@/components/landing/content";
import { Eyebrow, ExternalLink, SectionTitle } from "@/components/landing/parts";

/** Hero copy: the one orange moment of the page is Sign in (docs/DESIGN.md §4.1, public surfaces). */
export function HeroCopy({ allowSignup }: { allowSignup: boolean }) {
  return (
    <>
      <p className="mb-6 text-caption text-ink-muted sm:text-label">Space Works · Workspace · free and self-hosted</p>
      <h1 id="landing-hero-title" className="text-balance font-display text-[2.75rem] font-extrabold leading-[1.04] tracking-[-0.05em] sm:text-[4rem] lg:text-[5.75rem]">
        Your organisation.<br />In working order.
      </h1>
      <p className="mx-auto mt-6 max-w-[38rem] text-body-l text-ink-muted sm:text-xl">
        Projects, chat, docs, the kitty and the people who run them, on a server you control.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
        <Link href="/login" className={buttonClasses({ variant: "highlight", size: "lg", className: "gap-4 px-6" })}>
          Sign in <ArrowUpRight aria-hidden className="size-5" />
        </Link>
        {allowSignup
          ? <Link href="/signup" className="inline-flex min-h-11 items-center gap-3 rounded-md font-semibold hover:underline hover:underline-offset-[6px]">Create account <ArrowUpRight aria-hidden className="size-4" /></Link>
          : <a href="#install" className="inline-flex min-h-11 items-center gap-3 rounded-md font-semibold hover:underline hover:underline-offset-[6px]">Run your own <ArrowUpRight aria-hidden className="size-4" /></a>}
      </div>
      <p className="mt-5 text-caption text-ink-muted">Free to use. Self-hosted. Licensed AGPL-3.0-or-later.</p>
    </>
  );
}

const BENEFITS = [
  ["Every task has an owner.", "Assign to me in one click, see who assigned whom, and move cards by pointer, touch or keyboard."],
  ["Every decision has a home.", "Docs with revisions, chat with threads, and a team calendar for the meetings in between."],
  ["The kitty, in order.", "Income, expenses, donations and bank statements, ready for your accountant's export."],
] as const;

/** 01: arrives at the end of the hero scene, on the sky backdrop. Ink text keeps AA on sky. */
export function StoryContent() {
  return (
    <div className="landing-wrap text-sw-ink dark:text-ink">
      <div className="grid items-end gap-6 md:grid-cols-[1.4fr_1fr] md:gap-12 lg:gap-[90px]">
        <div><Eyebrow>01 / A little order goes a long way</Eyebrow><SectionTitle id="landing-story-title">Plan it. Talk it through.<br />Build it.</SectionTitle></div>
        <p className="max-w-md text-body-l md:text-xl dark:text-ink-muted">Boards, docs, chat and money in one place, for the team that keeps a maker organisation, NGO or community office running.</p>
      </div>
      <div className="mt-9 grid gap-7 md:mt-12 md:grid-cols-3 md:gap-14">
        {BENEFITS.map(([title, body], index) => (
          <div key={title}>
            <span className="mb-3 hidden text-caption tabular-nums md:block dark:text-ink-muted">0{index + 1}</span>
            <h3 className="mb-2 font-display text-lg font-extrabold tracking-[-0.02em] md:text-xl">{title}</h3>
            <p className="max-w-80 text-body-ui md:text-body dark:text-ink-muted">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The Deep Ink band: the release number is the page's single Unbounded accent. */
export function ReleaseBand() {
  return (
    <section aria-labelledby="landing-release-title" className="yy-dark-band bg-inverse py-24 text-center text-on-inverse md:py-32">
      <div data-reveal className="landing-wrap grid justify-items-center gap-6">
        <h2 id="landing-release-title" className="text-xl font-medium">Latest release</h2>
        <p className="landing-accent tabular-nums text-sw-yellow">{RELEASE.version}</p>
        <p className="max-w-2xl text-body-l text-ink-muted">Organisations with approval, limits and modules; more ways to sign in; payments, campaigns and bank import; makerspace stock; connected analytics; and a board and task upgrade. Released {RELEASE.date}.</p>
        <ExternalLink href={repoFile("CHANGELOG.md")} className="text-sw-citron">Read the changelog</ExternalLink>
      </div>
    </section>
  );
}

const STEPS = [
  { step: "Requested", body: "A signed-in person asks for a new organisation", who: "Requester" },
  { step: "Approved", body: "Decided in the super-admin console", who: "Super admin" },
  { step: "Limits set", body: "Members, guests, projects, storage and monthly email", who: "Super admin" },
  { step: "Modules chosen", body: "Finance on, email campaigns off, the rest as needed", who: "Super admin" },
];

/** 02: organisations, told through an example request record (the Labs loan ledger). */
export function OrganisationsSection() {
  return (
    <section aria-labelledby="landing-orgs-title" className="landing-section bg-canvas text-ink">
      <div className="landing-wrap grid items-center gap-10 md:grid-cols-2 md:gap-16 lg:gap-[100px]">
        <div data-reveal className="md:order-2 md:text-right">
          <Eyebrow>02 / Many organisations. One server.</Eyebrow>
          <SectionTitle id="landing-orgs-title">Ask for a space.<br />Get one that fits.</SectionTitle>
          <p className="mt-6 max-w-[34rem] text-body-l text-ink-muted md:ml-auto">People request a new organisation and the instance super admin approves it. Each one gets its own limits and modules, and owners watch their usage on a Plan &amp; limits page.</p>
          <p className="mt-7 max-w-96 text-xl font-medium md:ml-auto">One account, several organisations, a role in each.</p>
          <span className="mt-10 block text-caption text-ink-muted">Example organisation request</span>
        </div>
        <article data-reveal aria-labelledby="landing-ledger-title" className="overflow-hidden rounded-2xl border border-line bg-panel md:order-1">
          <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-5 sm:px-6">
            <span aria-hidden className="size-[11px] rounded-[3px] bg-sw-sky" />
            <h3 id="landing-ledger-title" className="mr-auto font-display text-lg font-extrabold tracking-[-0.02em]">Build Club · new organisation</h3>
            <Chip tone="success" size="sm">Active</Chip>
          </header>
          <ol className="px-5 sm:px-6">
            {STEPS.map((row) => (
              <li key={row.step} className="grid grid-cols-[1fr_auto] gap-3 border-b border-line py-5 last:border-b-0">
                <div><strong className="text-lg font-semibold">{row.step}</strong><p className="mt-1 text-body-ui text-ink-muted">{row.body}</p></div>
                <span className="text-right text-caption text-ink-muted">{row.who}</span>
              </li>
            ))}
          </ol>
          <footer className="bg-surface px-5 py-4 text-caption text-ink-muted sm:px-6"><b className="text-ink">Audited.</b> Super-admin access is recorded in the instance audit log only.</footer>
        </article>
      </div>
    </section>
  );
}


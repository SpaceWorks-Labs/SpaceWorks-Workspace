import type { CSSProperties } from "react";
import { AREAS } from "@/components/landing/content";
import { Dot, SectionHead } from "@/components/landing/parts";

/** 04: every area as a disclosure row, readable and crawlable without script. */
export function AreasSection() {
  return (
    <section aria-labelledby="landing-areas-title" className="landing-section landing-pattern landing-pattern-corner bg-canvas text-ink">
      <div className="landing-wrap">
        <SectionHead
          className="mx-auto max-w-[760px] text-center md:grid-cols-1 md:gap-6 lg:gap-6"
          leadClassName="mx-auto max-w-[40rem] text-ink-muted"
          eyebrow="04 / Room for the whole organisation"
          id="landing-areas-title"
          title={<>All the pieces.<br />One place.</>}
          lead="Work, money, people and operations in the same install. Owners switch modules on per organisation, and what you leave out simply isn't there."
        />
        <div className="grid items-start gap-x-14 md:grid-cols-2">
          {AREAS.map((area, index) => (
            <details key={area.id} data-reveal style={{ "--landing-i": index % 2 } as CSSProperties} className="landing-details border-t border-line">
              <summary className="flex min-h-[70px] cursor-pointer items-center gap-3 py-5 text-xl font-medium hover:text-accent-text md:min-h-[78px]">
                <Dot tone={area.tone} />
                {area.title}
                <span aria-hidden className="landing-expand text-2xl font-normal">+</span>
              </summary>
              <ul className="pb-7 pl-[23px]">
                {area.items.map(([lead, rest]) => (
                  <li key={lead} className="py-2 text-body-ui text-ink-muted"><b className="font-semibold text-ink">{lead}</b> {rest}</li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

const SCREENS = [
  { src: "home", title: "My day.", body: "Tasks, meetings, dues and activity." },
  { src: "project-board", title: "Project board.", body: "Milestones, blockers and the next build." },
  { src: "my-tasks", title: "My tasks.", body: "Assigned to me, assigned by me, my team and created by me." },
  { src: "chat", title: "Chat.", body: "Channels, threads and conversations." },
  { src: "finance-dark", title: "Finance, dark mode.", body: "Funds, bills and spending." },
  { src: "analytics", title: "Reports.", body: "Comparisons, drill-downs and board packs." },
];

/** 05: the dark band, with real screens from the seeded demo workspace. */
export function ScreensSection() {
  return (
    <section aria-labelledby="landing-screens-title" className="yy-dark-band landing-section bg-inverse text-on-inverse">
      <div className="landing-wrap">
        <SectionHead
          eyebrow="05 / One workspace, every screen"
          id="landing-screens-title"
          title={<>Real screens.<br />Seeded demo data.</>}
          lead="Taken on the demo workspace that ships with the repository. Light mode is the default; dark mode is one click away."
        />
        <ul className="grid gap-x-14 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
          {SCREENS.map((screen, index) => (
            <li key={screen.src} data-reveal style={{ "--landing-i": index % 3 } as CSSProperties} className="border-t border-line pt-7">
              <figure className="m-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- static screenshots from /public, sized to avoid layout shift */}
                <img src={`/landing/${screen.src}.webp`} alt={`${screen.title.replace(/\.$/, "")} in Space Works Workspace`} width={1440} height={900} loading="lazy" decoding="async" className="block h-auto w-full rounded-lg border border-line" />
                <figcaption className="mt-4 text-body-ui text-ink-muted"><b className="font-semibold text-on-inverse">{screen.title}</b> {screen.body}</figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

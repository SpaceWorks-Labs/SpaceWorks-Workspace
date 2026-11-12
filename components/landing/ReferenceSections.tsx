import { FOUNDATIONS, REPO_URL, repoFile } from "@/components/landing/content";
import { DOCS, questions } from "@/components/landing/content-docs";
import { ExternalLink, RuleItem, SectionHead } from "@/components/landing/parts";

/** 06: the docs, as Labs-style app cards that open GitHub. */
export function DocsSection() {
  return (
    <section id="docs" aria-labelledby="landing-docs-title" className="landing-section bg-canvas text-ink">
      <div className="landing-wrap">
        <SectionHead
          eyebrow="06 / Read before you run it"
          id="landing-docs-title"
          title={<>The docs.<br />All on GitHub.</>}
          lead={<>Guides for every area, the configuration reference and the architecture live next to the code in <ExternalLink href={REPO_URL} arrow={false} className="font-normal underline underline-offset-4">SpaceWorks-Workspace</ExternalLink>.</>}
        />
        <ul className="grid gap-x-14 sm:grid-cols-2 lg:grid-cols-3">
          {DOCS.map((doc, index) => (
            <li key={doc.title} className="contents">
              <RuleItem title={doc.title} index={index} className="border-line">
                <p className="mt-2.5 text-body-ui text-ink-muted md:text-body">{doc.body}</p>
                <ExternalLink href={doc.href} className="mt-auto pt-4 text-body-ui text-accent-text">Read on GitHub<span className="sr-only">: {doc.title}</span></ExternalLink>
              </RuleItem>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** 07: what every install gets, on the white panel band with a right-aligned head. */
export function FoundationsSection() {
  return (
    <section aria-labelledby="landing-foundations-title" className="landing-section bg-panel text-ink">
      <div className="landing-wrap">
        <SectionHead
          className="md:grid-cols-1 md:gap-6 md:text-right lg:gap-6"
          leadClassName="text-ink-muted md:ml-auto"
          eyebrow="07 / The foundations are covered"
          id="landing-foundations-title"
          title={<>Made to run.<br />Built to stay yours.</>}
          lead="These come with every install, whichever modules each organisation turns on."
        />
        <div className="grid gap-x-20 md:grid-cols-2">
          {FOUNDATIONS.map(([title, body], index) => (
            <RuleItem key={title} title={title} index={index} className="border-line">
              <p className="mt-3 max-w-[34rem] text-body-ui text-ink-muted md:text-body">{body}</p>
            </RuleItem>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 08: plain details/summary, so every answer is readable without script. */
export function FaqSection({ allowSignup }: { allowSignup: boolean }) {
  return (
    <section id="faq" aria-labelledby="landing-faq-title" className="landing-section bg-canvas text-ink">
      <div className="landing-wrap">
        <SectionHead
          eyebrow="08 / Good questions"
          id="landing-faq-title"
          title={<>Questions,<br />answered.</>}
          lead={<>Still unsure? Read <ExternalLink href={repoFile("docs/README.md")} arrow={false} className="font-normal underline underline-offset-4">the docs</ExternalLink> or <ExternalLink href={`${REPO_URL}/issues`} arrow={false} className="font-normal underline underline-offset-4">open an issue</ExternalLink>.</>}
        />
        <div className="max-w-[900px]">
          {questions(allowSignup).map((item) => (
            <details key={item.q} data-reveal className="landing-details border-t border-line last:border-b">
              <summary className="flex min-h-[72px] cursor-pointer items-center gap-4 py-4 hover:text-accent-text">
                <h3 className="text-lg font-medium md:text-xl">{item.q}</h3>
                <span aria-hidden className="landing-expand text-2xl">+</span>
              </summary>
              <p className="max-w-[46rem] pb-6 text-body text-ink-muted md:text-body-l">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

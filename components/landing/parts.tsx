import type { CSSProperties, ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/components/landing/content";

/** "01 / A little order goes a long way": the numbered kicker above every section heading. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mb-6 text-label tracking-[0.025em]", className)}>{children}</p>;
}

/** Section display heading: Gilroy ExtraBold, tight tracking, balanced lines. */
export function SectionTitle({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return <h2 id={id} className={cn("text-display-m text-balance lg:text-[3.5rem] lg:leading-[1.08] lg:tracking-[-0.035em]", className)}>{children}</h2>;
}

/** Heading on the left, a short lead on the right; stacks below md. */
export function SectionHead({ eyebrow, id, title, lead, className, leadClassName = "text-ink-muted" }: { eyebrow: string; id: string; title: ReactNode; lead?: ReactNode; className?: string; leadClassName?: string }) {
  return (
    <div data-reveal className={cn("mb-10 grid items-end gap-6 md:mb-14 md:grid-cols-[1.4fr_1fr] md:gap-12 lg:gap-[90px]", className)}>
      <div><Eyebrow>{eyebrow}</Eyebrow><SectionTitle id={id}>{title}</SectionTitle></div>
      {lead ? <div className={cn("max-w-md text-body-l md:text-xl", leadClassName)}>{lead}</div> : null}
    </div>
  );
}

const DOT: Record<Tone, string> = { sky: "bg-sw-sky", citron: "bg-sw-citron", yellow: "bg-sw-yellow", orange: "bg-sw-orange", line: "bg-line-strong" };

/** The small square swatch the Labs site uses to colour-code areas (decoration only). */
export function Dot({ tone }: { tone: Tone }) {
  return <span aria-hidden className={cn("size-[11px] shrink-0 rounded-[3px]", DOT[tone])} />;
}

/** External link that opens in a new tab and says so to screen readers. */
export function ExternalLink({ href, children, className, arrow = true }: { href: string; children: ReactNode; className?: string; arrow?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn("inline-flex items-center gap-2 font-semibold hover:underline hover:underline-offset-[5px]", className)}>
      {children}
      {arrow ? <ArrowUpRight aria-hidden className="size-4 shrink-0" /> : null}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** A hairline-topped list item, as in the Labs feature and surface grids. */
export function RuleItem({ title, children, index, className }: { title: ReactNode; children?: ReactNode; index?: number; className?: string }) {
  return (
    <article data-reveal style={index === undefined ? undefined : ({ "--landing-i": index % 3 } as CSSProperties)} className={cn("flex flex-col items-start border-t border-current/20 pt-7 pb-8", className)}>
      <h3 className="font-display text-xl font-extrabold leading-tight tracking-[-0.02em]">{title}</h3>
      {children}
    </article>
  );
}

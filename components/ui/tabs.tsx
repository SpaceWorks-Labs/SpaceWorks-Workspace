"use client";

import { forwardRef, useCallback, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ElementRef, type ReactNode, type Ref } from "react";
import Link from "next/link";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as AccordionPrimitive from "@radix-ui/react-accordion";

import { cn } from "@/lib/cn";

/* ---------- Underline tabs (docs/DESIGN.md §4.4): 2px teal (or event accent) underline ---------- */

export const Tabs = TabsPrimitive.Root;

const tabListClasses = "flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const tabClasses =
  "relative inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-semibold text-ink-muted transition-colors duration-[var(--sw-dur-fast)] ease-[var(--sw-ease-standard)] hover:text-ink after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:origin-center after:scale-x-0 after:rounded-full after:bg-transparent after:transition-[transform,background-color] after:duration-[var(--sw-dur-base)] after:ease-[var(--sw-ease-enter)] [&_svg]:size-4";

/**
 * Tab rows scroll sideways on narrow screens. These hints show a faded arrow
 * on each side that has hidden tabs, so people know there is more to see;
 * clicking an arrow scrolls the row. Keyboard users keep the tabs' own
 * arrow-key navigation, so the hint buttons are skipped in the tab order.
 */
function useScrollHints<T extends HTMLElement>() {
  const node = useRef<T | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const el = node.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((current) => (current.left === left && current.right === right ? current : { left, right }));
  }, []);
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const keepActiveVisible = () => {
      const active = el.querySelector<HTMLElement>('[aria-current="page"], [data-state="active"]');
      if (active) {
        const box = active.getBoundingClientRect();
        const viewport = el.getBoundingClientRect();
        if (box.left < viewport.left) el.scrollLeft -= viewport.left - box.left;
        else if (box.right > viewport.right) el.scrollLeft += box.right - viewport.right;
      }
      update();
    };
    keepActiveVisible();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    const selection = new MutationObserver(keepActiveVisible);
    selection.observe(el, { subtree: true, attributes: true, attributeFilter: ["aria-current", "data-state"] });
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
      selection.disconnect();
    };
  }, [update]);
  const scroll = (direction: -1 | 1) => {
    const el = node.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * Math.max(120, el.clientWidth * 0.7), behavior: reduce ? "auto" : "smooth" });
  };
  return { node, edges, scroll };
}

function setRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (value: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value);
      else if (ref) (ref as { current: T | null }).current = value;
    }
  };
}

function ScrollHint({ side, visible, onClick }: { side: "left" | "right"; visible: boolean; onClick: () => void }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-y-0 z-[1] flex items-center transition-opacity duration-[var(--sw-dur-fast)] ease-[var(--sw-ease-standard)]",
        side === "left" ? "left-0 bg-gradient-to-r from-canvas from-55% to-transparent pr-6" : "right-0 justify-end bg-gradient-to-l from-canvas from-55% to-transparent pl-6",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <button
        type="button"
        tabIndex={visible ? 0 : -1}
        aria-label={side === "left" ? "Show previous tabs" : "Show more tabs"}
        aria-hidden={!visible}
        onClick={onClick}
        className={cn(
          "inline-flex size-11 items-center justify-center rounded-md border border-line bg-panel text-ink-secondary transition-colors hover:bg-muted hover:text-ink",
          visible && "pointer-events-auto",
        )}
      >
        {side === "left" ? <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">←</span> : <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">→</span>}
      </button>
    </span>
  );
}

export const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(function TabsList(
  { className, ...props },
  ref,
) {
  const { node, edges, scroll } = useScrollHints<HTMLDivElement>();
  return (
    <div className="relative min-w-0">
      <ScrollHint side="left" visible={edges.left} onClick={() => scroll(-1)} />
      <TabsPrimitive.List ref={setRefs(ref, node)} className={cn(tabListClasses, className)} {...props} />
      <ScrollHint side="right" visible={edges.right} onClick={() => scroll(1)} />
    </div>
  );
});

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { accent?: boolean }
>(function TabsTrigger({ className, accent, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(tabClasses, "data-[state=active]:text-ink data-[state=active]:after:scale-x-100", accent ? "data-[state=active]:after:bg-accent-text" : "data-[state=active]:after:bg-[rgb(var(--sw-color-accent-ink))]", className)}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<ElementRef<typeof TabsPrimitive.Content>, ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(function TabsContent(
  { className, ...props },
  ref,
) {
  return <TabsPrimitive.Content ref={ref} className={cn("pt-6 focus-visible:outline-none", className)} {...props} />;
});

/** Link-based underline tabs for navigation between routes. */
export function NavTabs({ items, label, className }: { items: Array<{ href: string; label: ReactNode; active: boolean }>; label: string; className?: string }) {
  const { node, edges, scroll } = useScrollHints<HTMLElement>();
  return (
    <div className="relative min-w-0">
      <ScrollHint side="left" visible={edges.left} onClick={() => scroll(-1)} />
      <nav ref={node} aria-label={label} className={cn(tabListClasses, className)}>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={cn(tabClasses, item.active && "text-ink after:scale-x-100 after:bg-accent-text")}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <ScrollHint side="right" visible={edges.right} onClick={() => scroll(1)} />
    </div>
  );
}

/* ---------- Accordion ---------- */

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({ value, title, children, className }: { value: string; title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <AccordionPrimitive.Item value={value} className={cn("border-b border-line", className)}>
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger className="group flex w-full items-center justify-between gap-4 py-4 text-left text-base font-semibold text-ink">
          {title}
          {null}
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="pb-4 text-body text-ink-secondary">{children}</AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
}

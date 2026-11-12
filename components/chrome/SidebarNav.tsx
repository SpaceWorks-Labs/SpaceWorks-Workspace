"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { CollapsibleSection, useOpenState } from "@/components/ui/collapsible-section";
import type { ResolvedNavGroup } from "@/lib/nav";

const STORAGE_KEY = "sw:nav-open";

export function NavLink({ href, active, children, onNavigate }: { href: string; active: boolean; children: string; onNavigate?: () => void }) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (active) link.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  return (
    <Link
      ref={link}
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center rounded-md border border-transparent px-3 text-sm text-ink transition-colors duration-[120ms] hover:bg-sidebar-hover",
        active && "bg-sidebar-active border-accent-text font-semibold text-on-sidebar-active hover:bg-sidebar-active",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Link>
  );
}

/** Every labelled group collapses; the one holding the current page is always open. */
export function SidebarNav({ groups, active, onNavigate }: { groups: ResolvedNavGroup[]; active: string | null; onNavigate?: () => void }) {
  const activeGroup = groups.find((group) => group.items.some((item) => item.key === active))?.key;
  const { isOpen, setOpen } = useOpenState(STORAGE_KEY);

  return (
    <>
      {groups.map((group) => {
        const links = group.items.map((item) => (
          <NavLink key={item.key} href={item.href} active={active === item.key} onNavigate={onNavigate}>
            {item.label}
          </NavLink>
        ));
        if (!group.label) {
          return (
            <div key={group.key} className="flex flex-col gap-1">
              {links}
            </div>
          );
        }
        return (
          <CollapsibleSection
            key={group.key}
            id={`nav-group-${group.key}`}
            open={isOpen(group.key, !group.collapsedByDefault)}
            onOpenChange={(open) => setOpen(group.key, open)}
            forceOpen={group.key === activeGroup}
            title={group.label}
            className="flex flex-col gap-1"
            toggleClassName="w-full px-3 text-overline text-ink-muted hover:bg-sidebar-hover"
            bodyClassName="flex flex-col gap-1"
          >
            {links}
          </CollapsibleSection>
        );
      })}
    </>
  );
}

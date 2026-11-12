"use client";
import type { ReactNode } from "react";
import { CollapsibleSection, usePersistentOpen } from "@/components/ui/collapsible-section";

/** A CollapsibleSection that remembers its open state per section id (shared by stock and asset ops). */
export function PersistentSection({ id, title, count, defaultOpen = false, children }: { id: string; title: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = usePersistentOpen("sww.makerspace.sections", id, defaultOpen);
  return (
    <CollapsibleSection id={id} open={open} onOpenChange={setOpen} title={title} count={count} heading="h3" className="border-t border-line first:border-t-0" bodyClassName="pb-4 pt-2">
      {children}
    </CollapsibleSection>
  );
}

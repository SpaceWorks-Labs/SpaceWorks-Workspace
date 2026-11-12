import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "./display";

/**
 * Shared route-loading layouts (docs/DESIGN.md §2.10). Each mirrors the page it
 * stands in for (header, then content blocks) so nothing shifts on arrival, and
 * announces `label` once. The shimmer is static under reduced motion.
 */
function Frame({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={cn("sw-fade-in min-w-0 space-y-6", className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function HeaderSkeleton({ actions = true }: { actions?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0 flex-1 space-y-2.5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-2/3 max-w-[420px]" />
      </div>
      {actions ? <Skeleton className="h-11 w-32 rounded-md" /> : null}
    </div>
  );
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-12 items-center gap-4 px-4">
          <Skeleton className="size-5 shrink-0" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="hidden h-4 w-16 md:block" />
        </div>
      ))}
    </div>
  );
}

/** Generic page: header, a filter row and a block of content. */
export function PageSkeleton({ label = "Loading page" }: { label?: string }) {
  return (
    <Frame label={label}>
      <HeaderSkeleton />
      <Skeleton className="h-11 w-full max-w-[420px]" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </Frame>
  );
}

/** Table-like list: header, toolbar and rows. */
export function ListSkeleton({ label = "Loading list", rows = 8 }: { label?: string; rows?: number }) {
  return (
    <Frame label={label}>
      <HeaderSkeleton />
      <Skeleton className="h-11 w-full max-w-[520px]" />
      <RowsSkeleton rows={rows} />
    </Frame>
  );
}

/** Grid of cards (projects, members, dashboards). */
export function CardsSkeleton({ label = "Loading", cards = 6 }: { label?: string; cards?: number }) {
  return (
    <Frame label={label}>
      <HeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: cards }, (_, index) => (
          <div key={index} className="space-y-3 rounded-xl border border-line bg-panel p-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Kanban: columns of card skeletons. */
export function BoardSkeleton({ label = "Loading board" }: { label?: string }) {
  return (
    <Frame label={label}>
      <HeaderSkeleton />
      <div className="flex gap-4 overflow-hidden">
        {[3, 2, 3, 1].map((count, column) => (
          <div key={column} className="w-72 shrink-0 space-y-3 rounded-xl bg-surface p-3">
            <Skeleton className="h-5 w-24" />
            {Array.from({ length: count }, (_, index) => (
              <div key={index} className="space-y-2.5 rounded-xl border border-line bg-panel p-3">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** One record with a side rail (task, doc, file, member). */
export function DetailSkeleton({ label = "Loading details" }: { label?: string }) {
  return (
    <Frame label={label}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-10 w-3/4" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    </Frame>
  );
}

/** Channel: message rows and a composer. */
export function ChatSkeleton({ label = "Loading channel" }: { label?: string }) {
  return (
    <Frame label={label} className="flex h-full flex-col">
      <Skeleton className="h-8 w-48" />
      <div className="flex-1 space-y-5">
        {[3, 2, 4, 2].map((lines, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-32" />
              {Array.from({ length: lines > 2 ? 2 : 1 }, (_, line) => <Skeleton key={line} className="h-4 w-full max-w-[560px]" />)}
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
    </Frame>
  );
}

"use client";

import { TH } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { ariaSort, nextHeaderSort, type SortKey, type TaskQuery } from "@/lib/tasks/filters";

/**
 * A clickable column header of the list: sorts by the column, a second click
 * reverses it (`aria-sort` says which). The sort lives in the URL query.
 */
export function SortHeader({ label, column, query, onChange, className }: { label: string; column: SortKey; query: TaskQuery; onChange: (query: TaskQuery) => void; className?: string }) {
  const sort = ariaSort(query, column);
  return (
    <TH aria-sort={sort} className={cn(className)}>
      <button
        type="button"
        onClick={() => onChange({ ...query, ...nextHeaderSort(query, column) })}
        className="-mx-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--yy-focus)]"
      >
        {label}
        <span aria-hidden className={cn("text-xs", sort === "none" && "text-ink-muted opacity-50")}>
          {sort === "descending" ? "▾" : sort === "ascending" ? "▴" : "▴▾"}
        </span>
        <span className="sr-only">{sort === "none" ? ", sort" : sort === "ascending" ? ", sorted ascending" : ", sorted descending"}</span>
      </button>
    </TH>
  );
}

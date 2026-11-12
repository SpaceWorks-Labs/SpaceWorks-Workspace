"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SELECT_LIMIT_MESSAGE } from "@/lib/tasks/bulkSchemas";
import { prune, setMany, toggleAll, toggleOne } from "@/lib/tasks/selection";

/**
 * Row selection for the list view: click, Shift-click ranges (in visible row
 * order), section select-all, at most 50, Escape clears. Selected ids that
 * are no longer visible (filtered away, archived) drop out by themselves.
 */
export function useListSelection(ordered: string[]) {
  const [raw, setRaw] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const selected = useMemo(() => prune(raw, new Set(ordered)), [raw, ordered]);

  const apply = useCallback((change: { next: Set<string>; limited: boolean }) => {
    setRaw(change.next);
    setNotice(change.limited ? SELECT_LIMIT_MESSAGE : null);
  }, []);

  const toggle = useCallback((id: string, range: boolean) => {
    apply(toggleOne(selected, ordered, id, { range, anchor: anchor.current }));
    anchor.current = id;
  }, [apply, selected, ordered]);
  const toggleSection = useCallback((ids: string[]) => apply(toggleAll(selected, ids)), [apply, selected]);
  const deselect = useCallback((ids: readonly string[]) => apply(setMany(selected, ids, false)), [apply, selected]);
  const clear = useCallback(() => {
    setRaw(new Set());
    setNotice(null);
    anchor.current = null;
  }, []);

  const active = selected.size > 0;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="menu"], [role="listbox"], [role="dialog"]')) return;
      clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, clear]);

  return { selected, notice, toggle, toggleSection, deselect, clear };
}

import { MAX_BULK } from "@/lib/tasks/bulkSchemas";

/** Multi-select rules for the list view (pure, client-safe). `ordered` is the visible row order. */

export type TriState = boolean | "indeterminate";

/** Header checkbox state for a set of selectable ids. */
export function triState(selected: ReadonlySet<string>, selectable: readonly string[]): TriState {
  if (selectable.length === 0) return false;
  const count = selectable.filter((id) => selected.has(id)).length;
  return count === 0 ? false : count === selectable.length ? true : "indeterminate";
}

export type SelectionChange = { next: Set<string>; /** True when the limit stopped some ids from being added. */ limited: boolean };

/** Add (or remove) ids, never growing past `limit`. */
export function setMany(current: ReadonlySet<string>, ids: readonly string[], on: boolean, limit = MAX_BULK): SelectionChange {
  const next = new Set(current);
  let limited = false;
  for (const id of ids) {
    if (!on) next.delete(id);
    else if (next.has(id)) continue;
    else if (next.size >= limit) limited = true;
    else next.add(id);
  }
  return { next, limited };
}

/** The ids between `anchor` and `target` (inclusive) in visible order; just the target when the anchor is not visible. */
export function rangeBetween(ordered: readonly string[], anchor: string | null, target: string): string[] {
  const to = ordered.indexOf(target);
  const from = anchor ? ordered.indexOf(anchor) : -1;
  if (to === -1) return [];
  if (from === -1) return [target];
  return ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** Toggle one id; with `range` select everything from the anchor to it, matching the target's new state. */
export function toggleOne(current: ReadonlySet<string>, ordered: readonly string[], id: string, options: { range?: boolean; anchor?: string | null; limit?: number } = {}): SelectionChange {
  const on = !current.has(id);
  const ids = options.range ? rangeBetween(ordered, options.anchor ?? null, id) : [id];
  return setMany(current, ids, on, options.limit);
}

/** Header click: clear when every selectable row is selected, otherwise select them all (up to the limit). */
export function toggleAll(current: ReadonlySet<string>, selectable: readonly string[], limit = MAX_BULK): SelectionChange {
  const all = triState(current, selectable) === true;
  return setMany(current, selectable, !all, limit);
}

/** Drop ids that are no longer selectable (deleted, archived or filtered away). */
export function prune(current: ReadonlySet<string>, selectable: ReadonlySet<string>): Set<string> {
  const next = new Set([...current].filter((id) => selectable.has(id)));
  return next.size === current.size ? (current as Set<string>) : next;
}

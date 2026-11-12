/** Soft work-in-progress limits (pure, client-safe): the board warns, it never blocks. */

export type WipState = { limit: number | null; count: number; over: boolean; /** "4/3", or the bare count without a limit. */ label: string; /** Screen-reader sentence ("" without a limit). */ hint: string };

export function wipState(count: number, limit: number | null | undefined): WipState {
  if (!limit || limit < 1) return { limit: null, count, over: false, label: String(count), hint: "" };
  const over = count > limit;
  return {
    limit,
    count,
    over,
    label: `${count}/${limit}`,
    hint: over ? `Over the limit of ${limit} by ${count - limit}.` : `Limit ${limit}${count === limit ? ", reached" : ""}.`,
  };
}

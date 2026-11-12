import type { ActivityDTO } from "@/lib/tasks/types";

/** Description saves by the same person within this window read as one edit. */
export const DESCRIPTION_GROUP_MS = 10 * 60_000;

export type HistoryItem = ActivityDTO & {
  /** How many consecutive description saves this row stands for (1 = a single save). */
  count: number;
  /** Time of the oldest save folded into this row (internal: the grouping window follows the chain). */
  createdAtOldest?: string;
};

/**
 * Group consecutive description saves (pure, client-safe). `activity` is
 * newest first. Saves by the same person, each at most ten minutes after
 * the previous one and with nothing else in between, collapse into one row
 * (the newest save's time). Every other kind is kept as is.
 */
export function groupHistory(activity: readonly ActivityDTO[]): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const item of activity) {
    const last = out[out.length - 1];
    if (
      last &&
      item.kind === "description" &&
      last.kind === "description" &&
      (last.actor?.id ?? null) === (item.actor?.id ?? null) &&
      Math.abs(new Date(last.createdAtOldest ?? last.createdAt).getTime() - new Date(item.createdAt).getTime()) <= DESCRIPTION_GROUP_MS
    ) {
      last.count += 1;
      last.createdAtOldest = item.createdAt;
      continue;
    }
    out.push({ ...item, count: 1 });
  }
  return out;
}

/** "updated the description (3 saves)" for a grouped row; the original text for a single one. */
export function historyText(item: HistoryItem): string {
  return item.kind === "description" && item.count > 1 ? `${item.text} (${item.count} saves)` : item.text;
}

import type { ColumnCategory, LabelTone } from "@prisma/client";

/** Token classes for a column's header dot: its own colour when it has one, else its category. */
const TONE_DOT: Record<LabelTone, string> = {
  NEUTRAL: "bg-ink-muted",
  SUCCESS: "bg-success-solid",
  WARNING: "bg-warning-solid",
  INFO: "bg-info-solid",
  DANGER: "bg-danger-solid",
  ACCENT: "bg-accent",
  HIGHLIGHT: "bg-highlight",
};
const CATEGORY_DOT: Record<ColumnCategory, string> = { TODO: "bg-ink-muted", IN_PROGRESS: "bg-accent", DONE: "bg-success-solid" };

export const columnDot = (column: { color?: LabelTone | null; category: ColumnCategory }) => (column.color ? TONE_DOT[column.color] : CATEGORY_DOT[column.category]);

import type { LabelTone, TaskTypeIcon } from "@prisma/client";

/** Per-project task types (pure, client-safe). */

export type TaskTypeRef = { id: string; name: string; tone: LabelTone; icon: TaskTypeIcon; isDefault: boolean; position: number };

export const TASK_TYPE_ICONS: readonly TaskTypeIcon[] = ["TASK", "BUG", "FEATURE", "DOCS", "CHORE", "MILESTONE", "IDEA", "RISK"];
export const TASK_TYPE_ICON_LABELS: Record<TaskTypeIcon, string> = {
  TASK: "Task",
  BUG: "Bug",
  FEATURE: "Feature",
  DOCS: "Docs",
  CHORE: "Chore",
  MILESTONE: "Milestone",
  IDEA: "Idea",
  RISK: "Risk",
};

/** Created lazily the first time a project's types are read. */
export const DEFAULT_TASK_TYPES: ReadonlyArray<{ name: string; tone: LabelTone; icon: TaskTypeIcon; isDefault: boolean }> = [
  { name: "Task", tone: "NEUTRAL", icon: "TASK", isDefault: true },
  { name: "Bug", tone: "DANGER", icon: "BUG", isDefault: false },
  { name: "Feature", tone: "INFO", icon: "FEATURE", isDefault: false },
];

export const MAX_TASK_TYPES = 20;

/** The type a task shows: its own, else the project's default (null typeId). */
export function effectiveType<T extends { id: string; isDefault: boolean }>(types: readonly T[], typeId: string | null | undefined): T | null {
  return types.find((type) => type.id === typeId) ?? types.find((type) => type.isDefault) ?? null;
}

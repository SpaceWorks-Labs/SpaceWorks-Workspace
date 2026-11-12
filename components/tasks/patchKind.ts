import type { BoardTask } from "@/lib/tasks/types";

/** The fields a list cell can change in place. */
export type TaskPatch = Partial<Pick<BoardTask, "columnId" | "priority" | "dueAt" | "assigneeIds" | "completedAt">>;

/** Which server call a patch maps to; throws for an empty or unrecognised patch rather than guessing. */
export function patchKind(patch: TaskPatch): "move" | "priority" | "due" | "assignees" {
  if ("columnId" in patch && patch.columnId) return "move";
  if ("priority" in patch && patch.priority) return "priority";
  if ("dueAt" in patch) return "due";
  if ("assigneeIds" in patch && Array.isArray(patch.assigneeIds)) return "assignees";
  throw new Error("Unsupported task change.");
}

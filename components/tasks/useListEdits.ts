"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { moveTaskAction, setAssigneesAction, updateTaskAction } from "@/app/actions/tasks";
import { useToast } from "@/components/feedback/ToastProvider";
import type { ActionResult } from "@/lib/actionResult";
import { taskReference } from "@/lib/tasks/links";
import { fromDateInputValue, toDateInputValue } from "@/lib/tasks/localDate";
import type { BoardData, BoardTask } from "@/lib/tasks/types";
import { patchKind, type TaskPatch } from "./patchKind";
import { useAssignment } from "./useAssignment";

export type { TaskPatch };

/** Server call for a patch (one field group per call; the cells only ever send one). */
function send(slug: string, task: BoardTask, patch: TaskPatch, timeZone: string): Promise<ActionResult<unknown>> {
  switch (patchKind(patch)) {
    case "move":
      return moveTaskAction(slug, { taskId: task.id, columnId: patch.columnId as string, afterTaskId: null });
    case "priority":
      return updateTaskAction(slug, { taskId: task.id, priority: patch.priority });
    case "due":
      return updateTaskAction(slug, { taskId: task.id, dueDate: patch.dueAt ? toDateInputValue(new Date(patch.dueAt), timeZone) : null });
    case "assignees":
      return setAssigneesAction(slug, { taskId: task.id, userIds: patch.assigneeIds ?? [] });
  }
}

/** What the viewer sees of a column move: the column, and done when it is a Done column. */
export function movePatch(data: Pick<BoardData, "columns">, task: Pick<BoardTask, "completedAt">, columnId: string): TaskPatch {
  const column = data.columns.find((item) => item.id === columnId);
  return { columnId, completedAt: column?.category === "DONE" ? (task.completedAt ?? new Date().toISOString()) : null };
}

export const duePatch = (value: string, timeZone: string): TaskPatch => ({ dueAt: value ? (fromDateInputValue(value, timeZone)?.toISOString() ?? null) : null });

/**
 * Optimistic inline edits for the list view. A change shows at once as an
 * overlay on the rows, is rolled back with the server's message if refused,
 * and a success toast offers Undo. The overlay is dropped when fresh `tasks`
 * arrive (the board refetches after every change).
 */
export function useListEdits({ slug, viewerId, data, tasks, timeZone, onChanged }: { slug: string; viewerId?: string; data: BoardData; tasks: BoardTask[]; timeZone: string; onChanged?: () => void | Promise<void> }) {
  const { showToast } = useToast();
  const [overlay, setOverlay] = useState<Record<string, TaskPatch>>({});
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [seen, setSeen] = useState(tasks);
  if (seen !== tasks) {
    setSeen(tasks);
    setOverlay({});
    setHidden(new Set());
  }

  const patchMany = useCallback((ids: readonly string[], patch: (task: BoardTask) => TaskPatch) => {
    const set = new Set(ids);
    setOverlay((current) => {
      const next = { ...current };
      for (const task of tasks) if (set.has(task.id)) next[task.id] = { ...next[task.id], ...patch({ ...task, ...next[task.id] }) };
      return next;
    });
  }, [tasks]);
  const hide = useCallback((ids: readonly string[]) => setHidden((current) => new Set([...current, ...ids])), []);

  const shown = useMemo(() => tasks.filter((task) => !hidden.has(task.id)).map((task) => (overlay[task.id] ? { ...task, ...overlay[task.id] } : task)), [tasks, overlay, hidden]);

  const self = useRef<((task: BoardTask, patch: TaskPatch, undoable?: boolean) => Promise<boolean>) | null>(null);
  const change = useCallback(
    async (task: BoardTask, patch: TaskPatch, undoable = true): Promise<boolean> => {
      const previous: TaskPatch = {};
      for (const key of Object.keys(patch) as Array<keyof TaskPatch>) (previous as Record<string, unknown>)[key] = task[key];
      setOverlay((current) => ({ ...current, [task.id]: { ...current[task.id], ...patch } }));
      let result: ActionResult<unknown>;
      try {
        result = await send(slug, task, patch, timeZone);
      } catch {
        result = { ok: false, error: "Couldn't save. Check your connection and try again." };
      }
      if (!result.ok) {
        setOverlay((current) => ({ ...current, [task.id]: { ...current[task.id], ...previous } }));
        showToast(result.error, "error");
        return false;
      }
      const reference = taskReference(data.project.key, task.number);
      showToast(undoable ? `Updated ${reference}.` : `Reverted ${reference}.`, "success", undoable ? { label: "Undo", onClick: () => void self.current?.({ ...task, ...patch }, previous, false) } : null, 6000);
      await onChanged?.();
      return true;
    },
    [slug, timeZone, data.project.key, showToast, onChanged],
  );

  useEffect(() => {
    self.current = change;
  }, [change]);

  const applyAssignees = useCallback(
    (taskId: string, ids: string[]) => setOverlay((current) => ({ ...current, [taskId]: { ...current[taskId], assigneeIds: ids } })),
    [],
  );
  const claim = useAssignment(slug, viewerId ?? "", applyAssignees, onChanged);

  return { tasks: shown, change, claim: viewerId ? claim : null, patchMany, hide };
}

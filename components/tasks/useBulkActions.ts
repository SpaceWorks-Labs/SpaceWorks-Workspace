"use client";

import { useCallback, useState } from "react";
import { bulkUpdateTasksAction } from "@/app/actions/taskBulk";
import { useToast } from "@/components/feedback/ToastProvider";
import type { BulkOp, BulkResult } from "@/lib/tasks/bulkSchemas";
import type { BoardData, BoardTask } from "@/lib/tasks/types";
import { movePatch, type TaskPatch } from "./useListEdits";

export type BulkFailure = { ref: string; error: string };

function patchFor(op: BulkOp, data: Pick<BoardData, "columns">, viewerId: string | undefined, task: BoardTask): TaskPatch {
  switch (op.kind) {
    case "move":
      return movePatch(data, task, op.columnId);
    case "priority":
      return { priority: op.priority };
    case "assign":
      return { assigneeIds: [...new Set([...task.assigneeIds, op.userId])] };
    case "unassign":
      return { assigneeIds: task.assigneeIds.filter((id) => id !== op.userId) };
    case "claim":
      return viewerId ? { assigneeIds: [...new Set([...task.assigneeIds, viewerId])] } : {};
    case "archive":
      return {};
  }
}

/**
 * Run bulk operations on the selected tasks. Each operation is one server
 * call (the server loops the single-task services and answers per task).
 * Successful tasks are patched in place and deselected; failures stay
 * selected and are listed with their reference and reason.
 */
export function useBulkActions({
  slug,
  data,
  selected,
  viewerId,
  patchMany,
  hide,
  deselect,
  onChanged,
}: {
  slug: string;
  data: BoardData;
  selected: ReadonlySet<string>;
  viewerId?: string;
  patchMany: (ids: readonly string[], patch: (task: BoardTask) => TaskPatch) => void;
  hide: (ids: readonly string[]) => void;
  deselect: (ids: readonly string[]) => void;
  onChanged?: () => void | Promise<void>;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<BulkFailure[]>([]);

  const run = useCallback(
    async (ops: BulkOp[]) => {
      if (busy || selected.size === 0 || ops.length === 0) return;
      setBusy(true);
      setFailures([]);
      const ids = [...selected];
      const failed = new Map<string, BulkFailure>();
      try {
        for (const op of ops) {
          const pending = ids.filter((id) => !failed.has(id));
          if (pending.length === 0) break;
          const result = await bulkUpdateTasksAction(slug, { taskIds: pending, op });
          if (!result.ok) {
            showToast(result.error, "error");
            return;
          }
          const results: BulkResult[] = result.data?.results ?? [];
          for (const item of results) if (!item.ok && !failed.has(item.taskId)) failed.set(item.taskId, { ref: item.ref, error: item.error ?? "Couldn't update this task." });
          const okIds = results.filter((item) => item.ok).map((item) => item.taskId);
          if (op.kind === "archive") hide(okIds);
          else patchMany(okIds, (task) => patchFor(op, data, viewerId, task));
        }
        const done = ids.filter((id) => !failed.has(id));
        deselect(done);
        const list = [...failed.values()];
        setFailures(list);
        if (list.length === 0) showToast(`Updated ${done.length} ${done.length === 1 ? "task" : "tasks"}.`, "success");
        else if (done.length === 0) showToast(`Couldn't update ${list.length} ${list.length === 1 ? "task" : "tasks"}.`, "error");
        else showToast(`Updated ${done.length} ${done.length === 1 ? "task" : "tasks"} · ${list.length} failed`, "warning");
      } catch {
        showToast("Couldn't save. Check your connection and try again.", "error");
      } finally {
        setBusy(false);
        try {
          await onChanged?.();
        } catch {
          // The refetch failing must not mask the result already shown.
        }
      }
    },
    [busy, selected, slug, data, viewerId, patchMany, hide, deselect, showToast, onChanged],
  );

  return { run, busy, failures, dismissFailures: () => setFailures([]) };
}

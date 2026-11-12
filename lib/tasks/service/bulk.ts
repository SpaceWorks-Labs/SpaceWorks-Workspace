import "server-only";
import { prisma } from "@/lib/db";
import { validationError, type ActionResult } from "@/lib/actionResult";
import { visibleTaskWhere, type TaskActor } from "@/lib/tasks/access";
import { bulkInputSchema, type BulkOp, type BulkResult } from "@/lib/tasks/bulkSchemas";
import { taskReference } from "@/lib/tasks/links";
import { assignTask, claimTask, unassignTask } from "./assignments";
import { setTaskArchived } from "./labels-archive";
import { moveTask } from "./status";
import { updateTask } from "./create-update";

/**
 * Apply one operation to up to 50 tasks by looping over the single-task
 * services, so every task passes the same visibility, restrictTaskEdits,
 * archive and history rules as an individual edit. Tasks are processed one
 * at a time; one failure never stops the rest. Results come back per task.
 */

function run(actor: TaskActor, taskId: string, op: BulkOp, afterTaskId: string | null): Promise<ActionResult<unknown>> {
  switch (op.kind) {
    case "move":
      return moveTask(actor, { taskId, columnId: op.columnId, afterTaskId });
    case "priority":
      return updateTask(actor, { taskId, priority: op.priority });
    case "assign":
      return assignTask(actor, { taskId, userId: op.userId });
    case "unassign":
      return unassignTask(actor, { taskId, userId: op.userId });
    case "claim":
      return claimTask(actor, { taskId });
    case "archive":
      return setTaskArchived(actor, { taskId, archived: true });
  }
}

export async function bulkUpdateTasks(actor: TaskActor, input: unknown): Promise<ActionResult<{ results: BulkResult[] }>> {
  const parsed = bulkInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { taskIds, op } = parsed.data;
  const known = await prisma.task.findMany({
    where: { AND: [await visibleTaskWhere(actor), { id: { in: taskIds } }] },
    select: { id: true, number: true, project: { select: { key: true } } },
  });
  const refs = new Map(known.map((task) => [task.id, taskReference(task.project?.key, task.number)]));
  const results: BulkResult[] = [];
  // Moves keep the selection order: the first lands at the top of the column, each next one right after the previous.
  let previousMoved: string | null = null;
  for (const taskId of taskIds) {
    const ref = refs.get(taskId) ?? "Unknown task";
    try {
      const result = await run(actor, taskId, op, previousMoved);
      if (op.kind === "move" && result.ok) previousMoved = taskId;
      results.push(result.ok ? { taskId, ref, ok: true } : { taskId, ref, ok: false, error: result.error });
    } catch {
      results.push({ taskId, ref, ok: false, error: "Couldn't save this one. Try again." });
    }
  }
  return { ok: true, data: { results } };
}

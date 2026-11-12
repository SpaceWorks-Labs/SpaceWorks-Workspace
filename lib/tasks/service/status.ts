import "server-only";
import { prisma } from "@/lib/db";
import { recordActivity } from "@/lib/activity";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { type TaskActor } from "@/lib/tasks/access";
import { taskReference } from "@/lib/tasks/links";
import { placeAt, POSITION_GAP } from "@/lib/tasks/position";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { completeTaskSchema, moveTaskSchema } from "@/lib/tasks/schemas";
import {
  type Tx,
  type After,
  type LoadedTask,
  loadEditableTask,
  actorName,
  eventBase,
  notify,
  runAfter,
  addHistory,
  viaOf,
  visibleRecipients,
} from "./helpers";

/* ---------- Completion side effects ---------- */

async function afterStatusChange(tx: Tx, after: After, actor: TaskActor, task: LoadedTask, change: { completed: boolean | null; fromColumn: { id: string; name: string } | null; toColumn: { id: string; name: string } | null }) {
  const ref = taskReference(task.project?.key, task.number);
  if (change.completed === true) {
    await addHistory(tx, task.id, actor.user.id, "completed", undefined, viaOf(actor));
    await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "completed", entityType: "task", entityId: task.id, summary: `completed ${ref} ${task.title}`, projectId: task.projectId, teamId: task.project?.teamId ?? null }, tx);
  } else if (change.completed === false) {
    await addHistory(tx, task.id, actor.user.id, "reopened", undefined, viaOf(actor));
  }

  const assigneeIds = (await tx.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } })).map((row) => row.userId);
  const recipients = (await visibleRecipients(tx, actor.workspace.id, task.project, [...assigneeIds, task.creatorId])).filter((id) => id !== actor.user.id);
  const title =
    change.completed === true
      ? `${actorName(actor)} completed ${ref}: ${task.title}`
      : change.toColumn
        ? `${actorName(actor)} moved ${ref} to ${change.toColumn.name}: ${task.title}`
        : `${actorName(actor)} reopened ${ref}: ${task.title}`;
  const base = eventBase(actor, task, task.project);
  await notify(tx, after, actor.workspace.id, {
    ...base,
    type: "task.status_changed",
    title,
    recipients,
    data: { ...base.data, fromColumnId: change.fromColumn?.id ?? null, toColumnId: change.toColumn?.id ?? null },
  });

  if (change.completed !== true) return;

  // Unblock: tasks this one was blocking whose last open blocker just closed.
  const blocked = await tx.taskDependency.findMany({
    where: { workspaceId: actor.workspace.id, blockingTaskId: task.id, type: "BLOCKS", blockedTask: { workspaceId: actor.workspace.id, completedAt: null, archivedAt: null, blockerReason: null } },
    select: { blockedTask: { select: { id: true, number: true, title: true, projectId: true, project: true, assignees: { select: { userId: true } } } } },
  });
  for (const { blockedTask } of blocked) {
    const open = await tx.taskDependency.count({ where: { workspaceId: actor.workspace.id, blockedTaskId: blockedTask.id, type: "BLOCKS", blockingTask: { completedAt: null, archivedAt: null } } });
    if (open > 0) continue;
    await addHistory(tx, blockedTask.id, actor.user.id, "unblocked", { by: ref }, viaOf(actor));
    const ids = blockedTask.assignees.map((row) => row.userId);
    if (ids.length === 0) continue;
    const blockedBase = eventBase(actor, blockedTask, blockedTask.project);
    await notify(tx, after, actor.workspace.id, {
      ...blockedBase,
      type: "task.unblocked",
      title: `${taskReference(blockedTask.project?.key, blockedTask.number)} is ready to go: ${ref} is done`,
      recipients: ids,
      dedupeKey: `task.unblocked:${blockedTask.id}:${task.id}`,
      data: { ...blockedBase.data, blockerTaskId: task.id },
    });
  }

  // Repeat after completion: let the scheduler create the next instance.
  const rule = await tx.taskRecurrence.findFirst({
    where: { workspaceId: actor.workspace.id, active: true, createMode: "ON_COMPLETION", OR: [{ lastCreatedTaskId: task.id }, { templateTaskId: task.id, lastCreatedTaskId: null }] },
    select: { id: true },
  });
  if (rule) await tx.taskRecurrence.update({ where: { id: rule.id }, data: { nextRunAt: new Date() } });
}

/* ---------- Move on the board ---------- */

export async function moveTask(actor: TaskActor, input: unknown): Promise<ActionResult<{ warning?: string }>> {
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId, { action: "edit" });
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  if (!task.projectId || task.parentId) return actionError("Only tasks on a board can be moved.");
  const [target, source] = await Promise.all([
    prisma.boardColumn.findFirst({ where: { id: parsed.data.columnId, projectId: task.projectId } }),
    task.columnId ? prisma.boardColumn.findUnique({ where: { id: task.columnId } }) : Promise.resolve(null),
  ]);
  if (!target) return actionError("That column isn't on this board any more. Reload and try again.");
  const after: After = [];
  let warning: string | undefined;

  await prisma.$transaction(async (tx) => {
    const siblings = await tx.task.findMany({
      where: { columnId: target.id, parentId: null, archivedAt: null, id: { not: task.id } },
      orderBy: [{ position: "asc" }, { number: "asc" }],
      select: { id: true, position: true },
    });
    const anchor = parsed.data.afterTaskId ? siblings.findIndex((row) => row.id === parsed.data.afterTaskId) : -1;
    const index = parsed.data.afterTaskId === null ? 0 : anchor === -1 ? siblings.length : anchor + 1;
    const placement = placeAt(siblings.map((row) => row.position), index);
    if (placement.rebalanced) {
      for (const [i, row] of siblings.entries()) await tx.task.update({ where: { id: row.id }, data: { position: placement.rebalanced[i]! } });
    }
    const wasDone = Boolean(task.completedAt);
    const nowDone = target.category === "DONE";
    const completedChange = nowDone && !wasDone ? true : !nowDone && wasDone ? false : null;
    await tx.task.update({
      where: { id: task.id },
      data: { columnId: target.id, position: placement.position, ...(completedChange === true ? { completedAt: new Date() } : completedChange === false ? { completedAt: null } : {}) },
    });
    if (source?.id !== target.id) {
      await addHistory(tx, task.id, actor.user.id, "moved", { from: source?.name ?? null, to: target.name }, viaOf(actor));
      await afterStatusChange(tx, after, actor, task, { completed: completedChange, fromColumn: source ? { id: source.id, name: source.name } : null, toColumn: { id: target.id, name: target.name } });
    }
    if (completedChange === true) {
      const open = await tx.taskDependency.count({ where: { blockedTaskId: task.id, type: "BLOCKS", blockingTask: { completedAt: null, archivedAt: null } } });
      if (open > 0) warning = `Moved, but ${taskReference(task.project?.key, task.number)} is still blocked by ${open === 1 ? "another task" : `${open} tasks`}.`;
    }
  });
  await runAfter(after);
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true, data: warning ? { warning } : {} };
}

/* ---------- Complete / reopen (checkbox, My tasks, subtasks) ---------- */

export async function setTaskCompleted(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = completeTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId, { action: "edit" });
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const completed = parsed.data.completed;
  if (Boolean(task.completedAt) === completed) return { ok: true };
  const after: After = [];

  await prisma.$transaction(async (tx) => {
    let toColumn: { id: string; name: string; category: string } | null = null;
    const fromColumn = task.columnId ? await tx.boardColumn.findUnique({ where: { id: task.columnId }, select: { id: true, name: true, category: true } }) : null;
    if (task.projectId && !task.parentId) {
      const columns = await tx.boardColumn.findMany({ where: { projectId: task.projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, category: true } });
      if (completed && fromColumn?.category !== "DONE") toColumn = columns.find((column) => column.category === "DONE") ?? null;
      if (!completed && fromColumn?.category === "DONE") toColumn = columns.find((column) => column.category === "TODO") ?? columns.find((column) => column.category !== "DONE") ?? null;
    }
    let position = task.position;
    if (toColumn) {
      const edge = await tx.task.aggregate({ where: { columnId: toColumn.id, parentId: null, archivedAt: null }, _min: { position: true }, _max: { position: true } });
      position = completed ? (edge._min.position ?? POSITION_GAP * 2) - POSITION_GAP : (edge._max.position ?? 0) + POSITION_GAP;
    }
    await tx.task.update({ where: { id: task.id }, data: { completedAt: completed ? new Date() : null, ...(toColumn ? { columnId: toColumn.id, position } : {}) } });
    if (toColumn) await addHistory(tx, task.id, actor.user.id, "moved", { from: fromColumn?.name ?? null, to: toColumn.name }, viaOf(actor));
    await afterStatusChange(tx, after, actor, task, { completed, fromColumn: toColumn ? fromColumn : null, toColumn });
  });
  await runAfter(after);
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: task.parentId ? [task.id, task.parentId] : [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

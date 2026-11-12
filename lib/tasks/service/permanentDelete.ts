import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { hasRoleAtLeast } from "@/lib/roles";
import { removeSearchDocument } from "@/lib/search/documents";
import { deleteObjects } from "@/lib/storage";
import { canManageProject, type TaskActor } from "@/lib/tasks/access";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { deleteTaskSchema } from "@/lib/tasks/schemas";
import { ARCHIVED_PROJECT, loadVisibleTask, NOT_FOUND } from "./helpers";

export const NOT_ARCHIVED = "Archive this task first. Only archived tasks can be deleted for good.";
export const DELETE_FORBIDDEN = "Only admins and the project owner can delete a task for good.";
export const SUBTASK_DELETE = "Delete the parent task instead. Its subtasks go with it.";
export const WRONG_CONFIRM = "That doesn't match. Type the project key exactly to confirm.";

/**
 * Permanently delete an archived task (ADMIN or the project owner). The task
 * row goes with everything that cascades from it (subtasks, comments, history,
 * assignees, labels, dependencies, repeat rules, milestone and meeting links);
 * its files are deleted, its search documents and feed events removed, an audit
 * row (`task.deleted`) is written and boards are told (`task.removed`).
 */
export async function deleteTaskPermanently(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = deleteTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const task = await loadVisibleTask(actor, parsed.data.taskId);
  if (!task) return actionError(NOT_FOUND);
  const allowed = task.project ? canManageProject(actor, task.project) : hasRoleAtLeast(actor.membership.role, "ADMIN");
  if (!allowed) return actionError(DELETE_FORBIDDEN);
  if (task.project?.status === "ARCHIVED") return actionError(ARCHIVED_PROJECT);
  if (!task.archivedAt) return actionError(NOT_ARCHIVED);
  if (task.parentId) return actionError(SUBTASK_DELETE);
  const expected = task.project?.key ?? String(task.number);
  if (parsed.data.confirmKey.toUpperCase() !== expected.toUpperCase()) return actionError(WRONG_CONFIRM, { confirmKey: [WRONG_CONFIRM] });

  const storageKeys = await prisma.$transaction(async (tx) => {
    const subtasks = await tx.task.findMany({ where: { parentId: task.id, workspaceId: actor.workspace.id }, select: { id: true } });
    const ids = [task.id, ...subtasks.map((row) => row.id)];
    const files = await tx.fileObject.findMany({ where: { workspaceId: actor.workspace.id, taskId: { in: ids }, deletedAt: null }, select: { id: true, storageKey: true } });
    if (files.length) await tx.fileObject.updateMany({ where: { id: { in: files.map((file) => file.id) } }, data: { deletedAt: new Date() } });
    for (const id of ids) await removeSearchDocument("task", id, tx);
    await tx.activityEvent.deleteMany({ where: { workspaceId: actor.workspace.id, entityType: "task", entityId: { in: ids } } });
    await recordAuditEvent({
      action: "task.deleted",
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      targetType: "Task",
      targetId: task.id,
      metadata: { number: task.number, projectKey: task.project?.key ?? null, subtasks: subtasks.length, files: files.length },
      client: tx,
    });
    await tx.task.delete({ where: { id: task.id } });
    return files.map((file) => file.storageKey);
  });
  await deleteObjects(storageKeys).catch(() => undefined);
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "task.removed", actorId: actor.user.id });
  return { ok: true };
}

import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { type TaskActor } from "@/lib/tasks/access";
import { POSITION_GAP } from "@/lib/tasks/position";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { archiveTaskSchema, setLabelsSchema } from "@/lib/tasks/schemas";
import { indexTask } from "@/lib/tasks/search";
import {
  loadEditableTask,
  addHistory,
  viaOf,
  validateLabels,
} from "./helpers";

/* ---------- Labels ---------- */

export async function setLabels(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = setLabelsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId, { action: "edit" });
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const checked = await validateLabels(actor, parsed.data.labelIds, prisma);
  if (!checked.ok) return actionError("One of those labels no longer exists. Reload and try again.");
  const current = (await prisma.taskLabel.findMany({ where: { taskId: task.id }, select: { labelId: true, label: { select: { name: true } } } }));
  const currentIds = current.map((row) => row.labelId);
  const added = checked.labels.filter((label) => !currentIds.includes(label.id));
  const removed = current.filter((row) => !parsed.data.labelIds.includes(row.labelId));
  if (added.length === 0 && removed.length === 0) return { ok: true };
  await prisma.$transaction(async (tx) => {
    if (removed.length) await tx.taskLabel.deleteMany({ where: { taskId: task.id, labelId: { in: removed.map((row) => row.labelId) } } });
    if (added.length) await tx.taskLabel.createMany({ data: added.map((label) => ({ taskId: task.id, labelId: label.id })), skipDuplicates: true });
    await tx.task.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
    if (added.length) await addHistory(tx, task.id, actor.user.id, "labeled", { names: added.map((label) => label.name) }, viaOf(actor));
    if (removed.length) await addHistory(tx, task.id, actor.user.id, "unlabeled", { names: removed.map((row) => row.label.name) }, viaOf(actor));
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

/* ---------- Archive / restore ---------- */

export async function setTaskArchived(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = archiveTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId, { action: "edit", allowArchived: true });
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const archived = parsed.data.archived;
  if (Boolean(task.archivedAt) === archived) return { ok: true };
  await prisma.$transaction(async (tx) => {
    let position = task.position;
    if (!archived && task.columnId) {
      const edge = await tx.task.aggregate({ where: { columnId: task.columnId, parentId: null, archivedAt: null }, _max: { position: true } });
      position = (edge._max.position ?? 0) + POSITION_GAP;
    }
    const updated = await tx.task.update({ where: { id: task.id }, data: { archivedAt: archived ? new Date() : null, position } });
    await addHistory(tx, task.id, actor.user.id, archived ? "archived" : "restored", undefined, viaOf(actor));
    await recordAuditEvent({ action: archived ? "task.archived" : "task.restored", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Task", targetId: task.id, metadata: { number: task.number }, client: tx });
    await indexTask(tx, actor.workspace.slug, updated, task.project);
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: task.parentId ? [task.id, task.parentId] : [task.id], type: archived ? "task.removed" : "task.created", actorId: actor.user.id });
  return { ok: true };
}

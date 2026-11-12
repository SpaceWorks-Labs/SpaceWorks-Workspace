import "server-only";
import type { Project } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { findVisibleProject } from "@/lib/projects/service";
import { canEditTasks, type TaskActor } from "@/lib/tasks/access";
import { canPerformTaskAction } from "@/lib/tasks/capabilities";
import { taskReference, taskUrl } from "@/lib/tasks/links";
import { positionBetween } from "@/lib/tasks/position";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { transferTaskSchema } from "@/lib/tasks/schemas";
import { indexTask } from "@/lib/tasks/search";
import { ARCHIVED_PROJECT, ARCHIVED_TASK, NOT_FOUND, actorName, addHistory, capabilityInput, deniedMessage, eventBase, loadEditableTask, lockTask, notify, runAfter, viaOf, visibleRecipients, type After, type LoadedTask } from "./helpers";
import { planTransfer, type TransferPlan } from "./transferPlan";

/**
 * Move a task (with its subtasks) to another project in one transaction.
 * Per-project links are reset: milestone links and the cycle are removed,
 * the column is remapped by category, the type by name and assignees who
 * cannot see the target project are dropped. The workspace-unique number
 * (and so every reference) stays.
 */

export const SUBTASK_MESSAGE = "This is a subtask. Move the parent task instead.";
export const TEMPLATE_MESSAGE = "This task is the template of a repeating task. Stop the repeat before moving it.";
export const SAME_PROJECT_MESSAGE = "This task is already in that project.";

type Checked = { task: LoadedTask; target: Project } | { error: string };

/** Everything that must hold before a transfer (shared by the preview and the move). */
async function checkTransfer(actor: TaskActor, taskId: string, targetProjectKey: string): Promise<Checked> {
  if (!canEditTasks(actor)) return { error: NOT_ALLOWED };
  const found = await loadEditableTask(actor, taskId, { action: "edit" });
  if ("error" in found) return found;
  const { task } = found;
  if (task.parentId) return { error: SUBTASK_MESSAGE };
  if (await prisma.taskRecurrence.count({ where: { templateTaskId: task.id, active: true } })) return { error: TEMPLATE_MESSAGE };
  const target = await findVisibleProject(actor, { key: targetProjectKey.toUpperCase() });
  if (!target) return { error: "That project doesn't exist or you can't see it." };
  if (target.status === "ARCHIVED") return { error: ARCHIVED_PROJECT };
  if (target.id === task.projectId) return { error: SAME_PROJECT_MESSAGE };
  return { task, target };
}

export type TransferPreview = {
  target: { key: string; name: string };
  columnName: string | null;
  milestoneLinks: number;
  clearsCycle: boolean;
  droppedAssigneeIds: string[];
  subtaskCount: number;
  typeName: string | null;
  typeKept: boolean;
};

/** What a transfer would change, for the confirmation dialog. Writes nothing except lazily created default types. */
export async function previewTransfer(actor: TaskActor, input: unknown): Promise<ActionResult<TransferPreview>> {
  const parsed = transferTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const checked = await checkTransfer(actor, parsed.data.taskId, parsed.data.targetProjectKey);
  if ("error" in checked) return actionError(checked.error);
  const plan = await planTransfer(prisma, checked.task, checked.target, checked.task.projectId);
  return {
    ok: true,
    data: {
      target: { key: checked.target.key, name: checked.target.name },
      columnName: plan.targetColumn?.name ?? null,
      milestoneLinks: plan.milestoneLinks,
      clearsCycle: plan.clearsCycle,
      droppedAssigneeIds: [...new Set([...plan.dropped.values()].flat())],
      subtaskCount: plan.taskIds.length - 1,
      typeName: plan.typeName,
      typeKept: plan.typeKept,
    },
  };
}

export async function transferTask(actor: TaskActor, input: unknown): Promise<ActionResult<{ url: string; reference: string; key: string }>> {
  const parsed = transferTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const checked = await checkTransfer(actor, parsed.data.taskId, parsed.data.targetProjectKey);
  if ("error" in checked) return actionError(checked.error);
  const { task: loaded, target } = checked;
  const source = loaded.project;
  const after: After = [];

  const outcome = await prisma.$transaction(
    async (tx) => {
      await lockTask(tx, loaded.id);
      const task = await tx.task.findUnique({ where: { id: loaded.id } });
      if (!task || task.archivedAt) return { error: ARCHIVED_TASK };
      if (task.projectId !== loaded.projectId) return { error: NOT_FOUND };
      if (task.parentId) return { error: SUBTASK_MESSAGE };
      const assigneeIds = (await tx.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } })).map((row) => row.userId);
      const gate = capabilityInput(actor, loaded, assigneeIds);
      if (!canPerformTaskAction("edit", gate)) return { error: deniedMessage("edit", gate) };
      if (await tx.taskRecurrence.count({ where: { templateTaskId: task.id, active: true } })) return { error: TEMPLATE_MESSAGE };

      const plan: TransferPlan = await planTransfer(tx, task, target, task.projectId);
      const { taskIds, targetColumn } = plan;
      // Composite foreign keys (workspace, project, task) cascade on update: remove the links first.
      await tx.projectMilestoneTask.deleteMany({ where: { workspaceId: actor.workspace.id, taskId: { in: taskIds } } });
      for (const [id, userIds] of plan.dropped) if (userIds.length) await tx.taskAssignee.deleteMany({ where: { taskId: id, userId: { in: userIds } } });

      const edge = targetColumn ? await tx.task.aggregate({ where: { columnId: targetColumn.id, parentId: null, archivedAt: null }, _max: { position: true } }) : null;
      const position = positionBetween(edge?._max.position, null);
      const completedAt = targetColumn ? (targetColumn.category === "DONE" ? (task.completedAt ?? new Date()) : null) : task.completedAt;
      const common = { projectId: target.id, cycleId: null, typeId: plan.typeId };
      const updated = await tx.task.update({ where: { id: task.id }, data: { ...common, columnId: targetColumn?.id ?? null, position, completedAt } });
      await tx.task.updateMany({ where: { parentId: task.id }, data: common });

      const from = source ? { key: source.key, name: source.name } : null;
      const to = { key: target.key, name: target.name };
      for (const id of taskIds) await addHistory(tx, id, actor.user.id, "transferred", { from, to, droppedAssignees: plan.dropped.get(id) ?? [] }, viaOf(actor));
      const ref = taskReference(target.key, task.number);
      await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "moved", entityType: "task", entityId: task.id, summary: `moved ${ref} ${task.title} to ${target.name}`, projectId: target.id, teamId: target.teamId }, tx);
      await recordAuditEvent({ action: "task.transferred", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Task", targetId: task.id, metadata: { number: task.number, from: source?.key ?? null, to: target.key }, client: tx });
      for (const row of await tx.task.findMany({ where: { id: { in: taskIds } } })) await indexTask(tx, actor.workspace.slug, row, target);
      // People dropped because they can't see the target get the usual unassigned notice (visibility judged on the project they could see).
      const droppedIds = [...new Set([...plan.dropped.values()].flat())].filter((id) => id !== actor.user.id);
      const recipients = await visibleRecipients(tx, actor.workspace.id, source, droppedIds);
      if (recipients.length) {
        const sourceRef = taskReference(source?.key, task.number);
        await notify(tx, after, actor.workspace.id, { ...eventBase(actor, task, source), type: "task.unassigned", title: `${actorName(actor)} unassigned you from ${sourceRef}: ${task.title}`, recipients });
      }
      return { updated, plan, ids: taskIds };
    },
    { timeout: 20_000 },
  );
  if (outcome.error !== undefined) return actionError(outcome.error);
  await runAfter(after);

  if (source) await publishTaskChange({ workspaceId: actor.workspace.id, project: source, taskIds: outcome.ids, type: "task.removed", actorId: actor.user.id });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: target, taskIds: outcome.ids, type: "task.created", actorId: actor.user.id });
  const number = outcome.updated.number;
  return { ok: true, data: { url: taskUrl(actor.workspace.slug, target.key, number), reference: taskReference(target.key, number), key: target.key } };
}

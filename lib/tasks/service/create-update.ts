import "server-only";
import type { Prisma, Project } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import {
  actionError,
  NOT_ALLOWED,
  validationError,
  type ActionResult,
} from "@/lib/actionResult";
import { nextWorkspaceSequence } from "@/lib/counters";
import { canEditTasks, visibleProjectWhere, type TaskActor } from "@/lib/tasks/access";
import { taskReference, taskUrl } from "@/lib/tasks/links";
import { fromDateInputValue } from "@/lib/tasks/localDate";
import { POSITION_GAP } from "@/lib/tasks/position";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { sanitizeDescription } from "@/lib/tasks/sanitize";
import { createTaskSchema, updateTaskSchema } from "@/lib/tasks/schemas";
import { indexTask } from "@/lib/tasks/search";
import { effectiveType } from "@/lib/tasks/taskTypes";
import { defaultTaskType, listTaskTypesFor, resolveTypeForProject } from "./types";
import {
  type After,
  type LoadedTask,
  ARCHIVED_PROJECT,
  loadEditableTask,
  actorName,
  eventBase,
  notify,
  runAfter,
  addHistory,
  viaOf,
  validateAssignees,
  validateLabels,
} from "./helpers";

/** Returned (with a `conflict` field error) when the title or description changed since the editor opened. */
export const EDIT_CONFLICT = "Someone changed this while you were editing. Reload to see their version.";
const WRONG_TYPE = "That type isn't available on this project. Reload and try again.";

/* ---------- Create ---------- */

export async function createTask(actor: TaskActor, input: unknown): Promise<ActionResult<{ id: string; number: number; url: string; reference: string }>> {
  if (!canEditTasks(actor)) return actionError(NOT_ALLOWED);
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = parsed.data;

  let project: Project | null = null;
  let parent: LoadedTask | null = null;
  let columnId: string | null = null;
  let columnCategory: string | null = null;
  if (data.parentId) {
    const found = await loadEditableTask(actor, data.parentId, { action: "edit" });
    if ("error" in found) return actionError(found.error);
    parent = found.task;
    if (parent.parentId) return actionError("Subtasks can't have their own subtasks.");
    project = parent.project;
  } else if (data.projectId) {
    project = await prisma.project.findFirst({ where: { AND: [{ id: data.projectId }, await visibleProjectWhere(actor)] } });
    if (!project) return actionError(NOT_ALLOWED);
    const column = data.columnId
      ? await prisma.boardColumn.findFirst({ where: { id: data.columnId, projectId: project.id } })
      : await prisma.boardColumn.findFirst({ where: { projectId: project.id }, orderBy: { position: "asc" } });
    if (data.columnId && !column) return actionError("That column isn't on this board any more. Reload and try again.");
    columnId = column?.id ?? null;
    columnCategory = column?.category ?? null;
  }
  if (project?.status === "ARCHIVED") return actionError(ARCHIVED_PROJECT);

  const assignees = await validateAssignees(actor, project, data.assigneeIds, prisma);
  if (!assignees.ok) return actionError("Assign only members who can see this project.", { assigneeIds: ["Choose members of this project."] });
  const labels = await validateLabels(actor, data.labelIds, prisma);
  if (!labels.ok) return actionError("One of those labels no longer exists. Reload and try again.");
  const dueAt = data.dueDate ? fromDateInputValue(data.dueDate, actor.workspace.timezone) : null;
  if (data.dueDate && !dueAt) return actionError("Pick a valid date.", { dueDate: ["Pick a valid date."] });
  let typeId: string | null = null;
  if (project) {
    const type = data.typeId ? await resolveTypeForProject(actor.workspace.id, project.id, data.typeId) : await defaultTaskType(actor.workspace.id, project.id);
    if (data.typeId && !type) return actionError(WRONG_TYPE, { typeId: [WRONG_TYPE] });
    typeId = type?.id ?? null;
  } else if (data.typeId) return actionError(WRONG_TYPE, { typeId: [WRONG_TYPE] });
  const description = sanitizeDescription(data.description);
  const after: After = [];

  const task = await prisma.$transaction(async (tx) => {
    const number = await nextWorkspaceSequence(tx, actor.workspace.id, "task");
    let position = POSITION_GAP;
    if (columnId) {
      const edge = await tx.task.aggregate({ where: { columnId, parentId: null, archivedAt: null }, _max: { position: true }, _min: { position: true } });
      position = data.atTop ? (edge._min.position ?? POSITION_GAP * 2) - POSITION_GAP : (edge._max.position ?? 0) + POSITION_GAP;
    } else if (parent) {
      const edge = await tx.task.aggregate({ where: { parentId: parent.id }, _max: { position: true } });
      position = (edge._max.position ?? 0) + POSITION_GAP;
    }
    const task = await tx.task.create({
      data: {
        workspaceId: actor.workspace.id,
        projectId: project?.id ?? null,
        columnId,
        typeId,
        parentId: parent?.id ?? null,
        number,
        title: data.title,
        description,
        priority: data.priority,
        dueAt,
        position,
        creatorId: actor.user.id,
        completedAt: columnCategory === "DONE" ? new Date() : null,
        assignees: { create: assignees.userIds.map((userId) => ({ userId, assignedById: actor.user.id })) },
        labels: { create: data.labelIds.map((labelId) => ({ labelId })) },
      },
    });
    await addHistory(tx, task.id, actor.user.id, "created", undefined, viaOf(actor));
    if (parent) await addHistory(tx, parent.id, actor.user.id, "subtask_added", { number: task.number, title: task.title.slice(0, 120) }, viaOf(actor));
    await recordActivity(
      { workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "created", entityType: "task", entityId: task.id, summary: `created ${taskReference(project?.key, number)} ${task.title}`, projectId: project?.id ?? null, teamId: project?.teamId ?? null },
      tx,
    );
    await recordAuditEvent({ action: "task.created", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Task", targetId: task.id, metadata: { number, projectId: project?.id ?? null }, client: tx });
    await indexTask(tx, actor.workspace.slug, task, project);
    const recipients = assignees.userIds.filter((id) => id !== actor.user.id);
    if (recipients.length > 0) {
      await notify(tx, after, actor.workspace.id, {
        ...eventBase(actor, task, project),
        type: "task.assigned",
        title: `${actorName(actor)} assigned you ${taskReference(project?.key, number)}: ${task.title}`,
        recipients,
      });
    }
    return task;
  });
  await runAfter(after);
  await publishTaskChange({ workspaceId: actor.workspace.id, project, taskIds: parent ? [task.id, parent.id] : [task.id], type: "task.created", actorId: actor.user.id });
  return { ok: true, data: { id: task.id, number: task.number, url: taskUrl(actor.workspace.slug, project?.key, task.number), reference: taskReference(project?.key, task.number) } };
}

/* ---------- Edit fields ---------- */

export async function updateTask(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId, { action: "edit" });
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  // Edit-conflict guard: the editor sends the values it started from; a save over someone else's change is refused.
  if ((parsed.data.expectedTitle !== undefined && parsed.data.title !== undefined && parsed.data.expectedTitle !== task.title) || (parsed.data.expectedDescription !== undefined && parsed.data.description !== undefined && (parsed.data.expectedDescription ?? null) !== (task.description ?? null))) {
    return actionError(EDIT_CONFLICT, { conflict: [EDIT_CONFLICT] });
  }
  const data: Prisma.TaskUpdateInput = {};
  const history: Array<[string, Prisma.InputJsonValue]> = [];
  if (parsed.data.title !== undefined && parsed.data.title !== task.title) {
    data.title = parsed.data.title;
    history.push(["title", { from: task.title.slice(0, 120), to: parsed.data.title.slice(0, 120) }]);
  }
  if (parsed.data.description !== undefined) {
    const description = sanitizeDescription(parsed.data.description);
    if (description !== task.description) {
      data.description = description;
      history.push(["description", {}]);
    }
  }
  if (parsed.data.priority !== undefined && parsed.data.priority !== task.priority) {
    data.priority = parsed.data.priority;
    history.push(["priority", { from: task.priority, to: parsed.data.priority }]);
  }
  if (parsed.data.dueDate !== undefined) {
    const dueAt = parsed.data.dueDate ? fromDateInputValue(parsed.data.dueDate, actor.workspace.timezone) : null;
    if (parsed.data.dueDate && !dueAt) return actionError("Pick a valid date.", { dueDate: ["Pick a valid date."] });
    if (parsed.data.dueDate && task.startsOn && parsed.data.dueDate < task.startsOn.toISOString().slice(0, 10)) return actionError("Due date must be on or after the start date. Change the start date first.");
    if ((dueAt?.getTime() ?? null) !== (task.dueAt?.getTime() ?? null)) {
      data.dueAt = dueAt;
      history.push(["due", { to: dueAt?.toISOString() ?? null }]);
    }
  }
  if (parsed.data.typeId !== undefined) {
    if (!task.projectId) return actionError(WRONG_TYPE);
    const types = await listTaskTypesFor(actor.workspace.id, task.projectId);
    const next = parsed.data.typeId ? types.find((type) => type.id === parsed.data.typeId) : types.find((type) => type.isDefault);
    if (!next) return actionError(WRONG_TYPE, { typeId: [WRONG_TYPE] });
    const current = effectiveType(types, task.typeId);
    if (next.id !== current?.id) {
      data.type = parsed.data.typeId ? { connect: { id: next.id } } : { disconnect: true };
      history.push(["type_changed", { from: current?.name ?? null, to: next.name }]);
    }
  }
  if (history.length === 0) return { ok: true };
  await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: task.id }, data });
    for (const [kind, value] of history) await addHistory(tx, task.id, actor.user.id, kind, value, viaOf(actor));
    await indexTask(tx, actor.workspace.slug, updated, task.project);
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: task.parentId ? [task.id, task.parentId] : [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

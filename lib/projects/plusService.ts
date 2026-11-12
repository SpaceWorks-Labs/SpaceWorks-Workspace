import "server-only";

import type { Prisma, Project } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { canManageProjectPlan, canEditTaskPlan } from "@/lib/roles";
import { assignableMembers, visibleProjectWhere, visibleTaskWhere, type TaskActor } from "@/lib/tasks/access";
import { RESTRICTED_EDIT_MESSAGE, canPerformTaskAction } from "@/lib/tasks/capabilities";
import { canEditTaskInTx } from "@/lib/tasks/service/helpers";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { toDateInputValue } from "@/lib/tasks/localDate";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { indexTask } from "@/lib/tasks/search";
import { milestoneSchema, removeMilestoneSchema, statusUpdateSchema, taskPlanSchema } from "./plusLogic";

/** Re-resolve authority so stale callers cannot retain access after suspension or a role change. */
export async function projectActor(actor: TaskActor, client: DbClient = prisma): Promise<TaskActor | null> {
  const member = await client.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId: actor.user.id, status: "ACTIVE", user: { disabledAt: null }, workspace: { archivedAt: null } }, include: { workspace: true, user: { select: { id: true, name: true } } } });
  return member ? { user: member.user, workspace: member.workspace, membership: { role: member.role } } : null;
}
async function planProject(actor: TaskActor, projectId: string, tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${projectId} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
  const project = await tx.project.findFirst({ where: { AND: [await visibleProjectWhere(actor, tx), { id: projectId }] } });
  return project && project.status !== "ARCHIVED" && canManageProjectPlan(actor.membership, actor.user.id, project.ownerId) ? project : null;
}
async function recordChange(tx: Prisma.TransactionClient, actor: TaskActor, project: Project, type: string, id: string, title: string, body: string, action: string) {
  await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: `project.${action}`, targetType: type, targetId: id, metadata: { projectId: project.id }, client: tx });
  await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: action, entityType: type, entityId: id, summary: title, projectId: project.id, teamId: project.teamId }, tx);
  await indexSearchDocument({ workspaceId: actor.workspace.id, entityType: type, entityId: id, title, body, url: `/w/${actor.workspace.slug}/projects/${project.key}/${type === "project_update" ? "updates" : "overview"}`, projectId: project.id, teamId: project.teamId }, tx);
}
export async function saveMilestone(inputActor: TaskActor, input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await projectActor(inputActor);
  if (!actor) return actionError(NOT_ALLOWED);
  const parsed = milestoneSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = parsed.data;
  return prisma.$transaction(async tx => {
    const project = await planProject(actor, data.projectId, tx);
    if (!project) return actionError(NOT_ALLOWED);
    if (data.id && !await tx.projectMilestone.findFirst({ where: { workspaceId: actor.workspace.id, projectId: project.id, id: data.id } })) return actionError(NOT_ALLOWED);
    // Existing archived links may be retained; new links must point to active tasks in this project.
    const tasks = await tx.task.findMany({ where: { workspaceId: actor.workspace.id, projectId: project.id, id: { in: data.taskIds }, OR: [{ archivedAt: null }, ...(data.id ? [{ milestones: { some: { workspaceId: actor.workspace.id, milestoneId: data.id } } }] : [])] }, select: { id: true } });
    if (tasks.length !== data.taskIds.length) return actionError("Link tasks from this project only. Reload and try again.");
    // Adding or removing a link edits that task's plan, so restrictTaskEdits applies to each changed task.
    const linked = data.id ? (await tx.projectMilestoneTask.findMany({ where: { workspaceId: actor.workspace.id, milestoneId: data.id }, select: { taskId: true } })).map(link => link.taskId) : [];
    const changedIds = [...data.taskIds.filter(id => !linked.includes(id)), ...linked.filter(id => !data.taskIds.includes(id))];
    const changedTasks = changedIds.length ? await tx.task.findMany({ where: { workspaceId: actor.workspace.id, id: { in: changedIds } }, select: { id: true, creatorId: true } }) : [];
    if (!await canEditTaskInTx(tx, actor, changedTasks, project)) return actionError(RESTRICTED_EDIT_MESSAGE);
    const values = { name: data.name, targetOn: new Date(`${data.targetOn}T00:00:00Z`), status: data.status, notes: data.notes };
    const milestone = data.id
      ? await tx.projectMilestone.update({ where: { id: data.id, workspaceId: actor.workspace.id, projectId: project.id }, data: values })
      : await tx.projectMilestone.create({ data: { ...values, workspaceId: actor.workspace.id, projectId: project.id, createdById: actor.user.id } });
    await tx.projectMilestoneTask.deleteMany({ where: { workspaceId: actor.workspace.id, milestoneId: milestone.id } });
    if (tasks.length) await tx.projectMilestoneTask.createMany({ data: tasks.map(t => ({ workspaceId: actor.workspace.id, projectId: project.id, milestoneId: milestone.id, taskId: t.id })) });
    await recordChange(tx, actor, project, "project_milestone", milestone.id, data.name, data.notes, data.id ? "milestone_updated" : "milestone_created");
    return { ok: true, data: { id: milestone.id } };
  });
}
export async function removeMilestone(inputActor: TaskActor, input: unknown): Promise<ActionResult> {
  const actor = await projectActor(inputActor);
  if (!actor) return actionError(NOT_ALLOWED);
  const parsed = removeMilestoneSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return prisma.$transaction(async tx => {
    const project = await planProject(actor, parsed.data.projectId, tx);
    if (!project) return actionError(NOT_ALLOWED);
    const deleted = await tx.projectMilestone.deleteMany({ where: { id: parsed.data.id, workspaceId: actor.workspace.id, projectId: project.id } });
    if (deleted.count) {
      await removeSearchDocument("project_milestone", parsed.data.id, tx);
      await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: "project.milestone_removed", targetType: "project_milestone", targetId: parsed.data.id, client: tx });
    }
    return { ok: true };
  });
}
export async function postStatusUpdate(inputActor: TaskActor, input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await projectActor(inputActor);
  if (!actor) return actionError(NOT_ALLOWED);
  const parsed = statusUpdateSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return prisma.$transaction(async tx => {
    const project = await planProject(actor, parsed.data.projectId, tx);
    if (!project) return actionError(NOT_ALLOWED);
    const update = await tx.projectStatusUpdate.create({ data: { ...parsed.data, workspaceId: actor.workspace.id, authorId: actor.user.id } });
    await recordChange(tx, actor, project, "project_update", update.id, `${project.name}: weekly update`, [update.note, ...update.blockers, ...update.nextSteps].join("\n"), "update_posted");
    return { ok: true, data: { id: update.id } };
  });
}
export async function saveTaskPlan(inputActor: TaskActor, input: unknown): Promise<ActionResult> {
  const actor = await projectActor(inputActor);
  if (!actor || !canEditTaskPlan(actor.membership)) return actionError(NOT_ALLOWED);
  const parsed = taskPlanSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = parsed.data;
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id=${data.taskId} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
    const task = await tx.task.findFirst({ where: { AND: [await visibleTaskWhere(actor, tx), { id: data.taskId, archivedAt: null }] }, include: { project: true } });
    if (!task || task.project?.status === "ARCHIVED") return { error: NOT_ALLOWED };
    const assigneeIds = (await tx.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } })).map(row => row.userId);
    if (!canPerformTaskAction("edit", { role: actor.membership.role, userId: actor.user.id, restrictTaskEdits: task.project?.restrictTaskEdits ?? false, projectOwnerId: task.project?.ownerId ?? null, creatorId: task.creatorId, assigneeIds })) return { error: RESTRICTED_EDIT_MESSAGE };
    if (data.startsOn && task.dueAt && data.startsOn > toDateInputValue(task.dueAt, actor.workspace.timezone)) return { error: "Start must be on or before the due date. Change the due date first." };
    if (data.blockerOwnerId && !(await assignableMembers(actor.workspace.id, task.project, tx)).some(p => p.id === data.blockerOwnerId)) return { error: "Choose an active member who can see this task." };
    const updated = await tx.task.update({ where: { id: task.id, workspaceId: actor.workspace.id }, data: { startsOn: data.startsOn ? new Date(`${data.startsOn}T00:00:00Z`) : null, blockerReason: data.blockerReason || null, blockerOwnerId: data.blockerReason ? data.blockerOwnerId : null } });
    await indexTask(tx, actor.workspace.slug, updated, task.project);
    await tx.taskActivity.create({ data: { taskId: task.id, actorId: actor.user.id, kind: "plan_updated" } });
    await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: "project.task_plan_updated", targetType: "Task", targetId: task.id, client: tx });
    return { task };
  });
  if (result.error) return actionError(result.error);
  if (result.task) await publishTaskChange({ workspaceId: actor.workspace.id, project: result.task.project, taskIds: [result.task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

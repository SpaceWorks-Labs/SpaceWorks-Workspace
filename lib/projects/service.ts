import "server-only";

import type { ColumnCategory, Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { hasRoleAtLeast } from "@/lib/roles";
import { hiddenTeamIds } from "@/lib/teamAccess";
import { COLUMN_TEMPLATES } from "@/lib/projects/keys";
import { canEditTasks, canManageProject, visibleProjectWhere, type TaskActor } from "@/lib/tasks/access";
import { POSITION_GAP } from "@/lib/tasks/position";
import { publishTaskChange } from "@/lib/tasks/realtime";
import {
  addColumnSchema,
  createProjectSchema,
  deleteColumnSchema,
  projectIdSchema,
  reorderColumnsSchema,
  updateColumnSchema,
  updateProjectSchema,
} from "@/lib/tasks/schemas";
import { indexProject, indexTask } from "@/lib/tasks/search";

/**
 * Project and column mutations. Callers (Server Actions, tests) pass an
 * actor resolved server-side; every function re-checks capability and
 * tenant ownership itself. Return `ActionResult`.
 */

const ARCHIVED_ERROR = "This project is archived. Restore it to make changes.";

/** Project dates are calendar days; store them as UTC midnight (Postgres DATE). */
function toDbDate(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

async function checkOwner(actor: TaskActor, ownerId: string | null | undefined, client: DbClient): Promise<string | null | "invalid"> {
  if (!ownerId) return null;
  const membership = await client.membership.findUnique({ where: { userId_workspaceId: { userId: ownerId, workspaceId: actor.workspace.id } }, select: { role: true, status: true } });
  if (!membership || membership.status !== "ACTIVE" || !hasRoleAtLeast(membership.role, "MEMBER")) return "invalid";
  return ownerId;
}

async function checkTeam(actor: TaskActor, teamId: string | null | undefined, client: DbClient): Promise<string | null | "invalid"> {
  if (!teamId) return null;
  const team = await client.team.findFirst({ where: { id: teamId, workspaceId: actor.workspace.id, archivedAt: null }, select: { id: true } });
  if (!team) return "invalid";
  const hidden = await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role }, client);
  return hidden.includes(teamId) ? "invalid" : teamId;
}

export async function findVisibleProject(actor: TaskActor, where: { id: string } | { key: string }, client: DbClient = prisma) {
  return client.project.findFirst({ where: { AND: [await visibleProjectWhere(actor, client), where] } });
}

export async function createProject(actor: TaskActor, input: unknown): Promise<ActionResult<{ id: string; key: string }>> {
  if (!canEditTasks(actor)) return actionError(NOT_ALLOWED);
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = parsed.data;
  const ownerId = await checkOwner(actor, data.ownerId ?? actor.user.id, prisma);
  if (ownerId === "invalid") return actionError("Choose an owner who is a member of this workspace.", { ownerId: ["Choose a member."] });
  const teamId = await checkTeam(actor, data.teamId, prisma);
  if (teamId === "invalid") return actionError("Choose a team you belong to.", { teamId: ["Choose a team."] });
  if (await prisma.project.findUnique({ where: { workspaceId_key: { workspaceId: actor.workspace.id, key: data.key } }, select: { id: true } })) {
    return actionError("That key is already used by another project.", { key: ["Pick a different key."] });
  }
  try {
    const project = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          workspaceId: actor.workspace.id,
          key: data.key,
          name: data.name,
          description: data.description,
          ownerId,
          teamId,
          startsOn: toDbDate(data.startsOn),
          dueOn: toDbDate(data.dueOn),
        },
      });
      await tx.boardColumn.createMany({
        data: COLUMN_TEMPLATES[data.template].columns.map((column, position) => ({ projectId: project.id, name: column.name, category: column.category, position })),
      });
      await recordAuditEvent({ action: "project.created", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Project", targetId: project.id, metadata: { key: project.key }, client: tx });
      await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "created", entityType: "project", entityId: project.id, summary: `started the project ${project.name}`, projectId: project.id, teamId }, tx);
      await indexProject(tx, actor.workspace.slug, project);
      return project;
    });
    return { ok: true, data: { id: project.id, key: project.key } };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return actionError("That key is already used by another project.", { key: ["Pick a different key."] });
    throw error;
  }
}

export async function updateProject(actor: TaskActor, input: unknown): Promise<ActionResult<{ key: string }>> {
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = parsed.data;
  const project = await findVisibleProject(actor, { id: data.projectId });
  if (!project || !canManageProject(actor, project)) return actionError(NOT_ALLOWED);
  if (project.status === "ARCHIVED") return actionError(ARCHIVED_ERROR);
  const ownerId = await checkOwner(actor, data.ownerId, prisma);
  if (ownerId === "invalid") return actionError("Choose an owner who is a member of this workspace.", { ownerId: ["Choose a member."] });
  const teamId = data.teamId === project.teamId ? project.teamId : await checkTeam(actor, data.teamId, prisma);
  if (teamId === "invalid") return actionError("Choose a team you belong to.", { teamId: ["Choose a team."] });
  if (data.key !== project.key && (await prisma.project.findUnique({ where: { workspaceId_key: { workspaceId: actor.workspace.id, key: data.key } }, select: { id: true } }))) {
    return actionError("That key is already used by another project.", { key: ["Pick a different key."] });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: project.id },
      data: { cyclesEnabled: data.cyclesEnabled, restrictTaskEdits: data.restrictTaskEdits, name: data.name, key: data.key, description: data.description, ownerId, teamId, status: data.status, startsOn: toDbDate(data.startsOn), dueOn: toDbDate(data.dueOn) },
    });
    await recordAuditEvent({
      action: "project.updated",
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      targetType: "Project",
      targetId: project.id,
      metadata: { key: updated.key, status: updated.status, keyChanged: updated.key !== project.key, cyclesEnabled: updated.cyclesEnabled, restrictTaskEdits: updated.restrictTaskEdits, teamChanged: updated.teamId !== project.teamId },
      client: tx,
    });
    await indexProject(tx, actor.workspace.slug, updated);
    for (const [entityType, tab] of [["project_milestone", "overview"], ["project_update", "updates"]]) {
      await tx.searchDocument.updateMany({ where: { workspaceId: actor.workspace.id, projectId: project.id, entityType }, data: { teamId: updated.teamId, url: `/w/${actor.workspace.slug}/projects/${updated.key}/${tab}` } });
    }
    await tx.activityEvent.updateMany({ where: { workspaceId: actor.workspace.id, projectId: project.id, entityType: { in: ["project_milestone", "project_update"] } }, data: { teamId: updated.teamId } });
    return updated;
  });
  if (updated.key !== project.key || updated.teamId !== project.teamId) await reindexProjectTasks(actor.workspace.slug, updated);
  await publishTaskChange({ workspaceId: actor.workspace.id, project: updated, taskIds: [], type: "board.changed", actorId: actor.user.id });
  return { ok: true, data: { key: updated.key } };
}

async function reindexProjectTasks(workspaceSlug: string, project: { id: string; key: string; teamId: string | null }) {
  const tasks = await prisma.task.findMany({
    where: { projectId: project.id },
    select: { id: true, workspaceId: true, number: true, title: true, description: true, blockerReason: true, archivedAt: true, creatorId: true },
  });
  for (const task of tasks) await indexTask(prisma, workspaceSlug, task, project);
}

export async function setProjectArchived(actor: TaskActor, input: unknown, archived: boolean): Promise<ActionResult> {
  const parsed = projectIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const project = await findVisibleProject(actor, { id: parsed.data.projectId });
  if (!project || !canManageProject(actor, project)) return actionError(NOT_ALLOWED);
  if (archived === (project.status === "ARCHIVED")) return { ok: true };
  await prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({ where: { id: project.id }, data: { status: archived ? "ARCHIVED" : "ACTIVE" } });
    await recordAuditEvent({ action: archived ? "project.archived" : "project.restored", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Project", targetId: project.id, metadata: { key: project.key }, client: tx });
    await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: archived ? "archived" : "restored", entityType: "project", entityId: project.id, summary: `${archived ? "archived" : "restored"} the project ${project.name}`, projectId: project.id, teamId: project.teamId }, tx);
    await indexProject(tx, actor.workspace.slug, updated);
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project, taskIds: [], type: "board.changed", actorId: actor.user.id });
  return { ok: true };
}

/* ---------- Columns ---------- */

async function projectForColumns(actor: TaskActor, projectId: string) {
  const project = await findVisibleProject(actor, { id: projectId });
  if (!project || !canManageProject(actor, project)) return { error: NOT_ALLOWED } as const;
  if (project.status === "ARCHIVED") return { error: ARCHIVED_ERROR } as const;
  return { project } as const;
}

export async function addColumn(actor: TaskActor, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = addColumnSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await projectForColumns(actor, parsed.data.projectId);
  if (found.error) return actionError(found.error);
  const project = found.project;
  const count = await prisma.boardColumn.count({ where: { projectId: project.id } });
  if (count >= 20) return actionError("A board can have up to 20 columns.");
  const column = await prisma.$transaction(async (tx) => {
    const last = await tx.boardColumn.findFirst({ where: { projectId: project.id }, orderBy: { position: "desc" }, select: { position: true } });
    const column = await tx.boardColumn.create({ data: { projectId: project.id, name: parsed.data.name, category: parsed.data.category, position: (last?.position ?? -1) + 1 } });
    await recordAuditEvent({ action: "project.column_added", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Project", targetId: project.id, metadata: { columnId: column.id }, client: tx });
    return column;
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project, taskIds: [], type: "board.changed", actorId: actor.user.id });
  return { ok: true, data: { id: column.id } };
}

/** Moving tasks into or out of a Done column completes or reopens them. */
async function syncCompletion(tx: Prisma.TransactionClient, columnId: string, category: ColumnCategory) {
  if (category === "DONE") await tx.task.updateMany({ where: { columnId, completedAt: null }, data: { completedAt: new Date() } });
  else await tx.task.updateMany({ where: { columnId, completedAt: { not: null } }, data: { completedAt: null } });
}

export async function updateColumn(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = updateColumnSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const column = await prisma.boardColumn.findFirst({ where: { id: parsed.data.columnId, project: { workspaceId: actor.workspace.id } } });
  if (!column) return actionError(NOT_ALLOWED);
  const found = await projectForColumns(actor, column.projectId);
  if (found.error) return actionError(found.error);
  await prisma.$transaction(async (tx) => {
    await tx.boardColumn.update({ where: { id: column.id }, data: { name: parsed.data.name, category: parsed.data.category } });
    if ((column.category === "DONE") !== (parsed.data.category === "DONE")) await syncCompletion(tx, column.id, parsed.data.category);
    await recordAuditEvent({ action: "project.column_updated", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Project", targetId: column.projectId, metadata: { columnId: column.id, category: parsed.data.category }, client: tx });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: found.project, taskIds: [], type: "board.changed", actorId: actor.user.id });
  return { ok: true };
}

export async function reorderColumns(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = reorderColumnsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await projectForColumns(actor, parsed.data.projectId);
  if (found.error) return actionError(found.error);
  const columns = await prisma.boardColumn.findMany({ where: { projectId: found.project.id }, select: { id: true } });
  const wanted = parsed.data.columnIds;
  if (wanted.length !== columns.length || new Set(wanted).size !== wanted.length || !columns.every((column) => wanted.includes(column.id))) {
    return actionError("The board changed while you were editing. Reload and try again.");
  }
  await prisma.$transaction(async (tx) => {
    for (const [position, id] of wanted.entries()) await tx.boardColumn.update({ where: { id }, data: { position } });
    await recordAuditEvent({ action: "project.columns_reordered", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Project", targetId: found.project.id, client: tx });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: found.project, taskIds: [], type: "board.changed", actorId: actor.user.id });
  return { ok: true };
}

export async function deleteColumn(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = deleteColumnSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (parsed.data.columnId === parsed.data.moveToColumnId) return actionError("Pick another column for its tasks.");
  const column = await prisma.boardColumn.findFirst({ where: { id: parsed.data.columnId, project: { workspaceId: actor.workspace.id } } });
  if (!column) return actionError(NOT_ALLOWED);
  const found = await projectForColumns(actor, column.projectId);
  if (found.error) return actionError(found.error);
  const target = await prisma.boardColumn.findFirst({ where: { id: parsed.data.moveToColumnId, projectId: column.projectId } });
  if (!target) return actionError("Pick another column for its tasks.");
  await prisma.$transaction(async (tx) => {
    const last = await tx.task.findFirst({ where: { columnId: target.id }, orderBy: { position: "desc" }, select: { position: true } });
    const moving = await tx.task.findMany({ where: { columnId: column.id }, orderBy: [{ position: "asc" }, { number: "asc" }], select: { id: true } });
    let position = (last?.position ?? 0) + POSITION_GAP;
    for (const task of moving) {
      await tx.task.update({ where: { id: task.id }, data: { columnId: target.id, position } });
      position += POSITION_GAP;
    }
    await syncCompletion(tx, target.id, target.category);
    await tx.boardColumn.delete({ where: { id: column.id } });
    const rest = await tx.boardColumn.findMany({ where: { projectId: column.projectId }, orderBy: { position: "asc" }, select: { id: true } });
    for (const [index, item] of rest.entries()) await tx.boardColumn.update({ where: { id: item.id }, data: { position: index } });
    await recordAuditEvent({ action: "project.column_deleted", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Project", targetId: column.projectId, metadata: { columnId: column.id, movedTasks: moving.length }, client: tx });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: found.project, taskIds: [], type: "board.changed", actorId: actor.user.id });
  return { ok: true };
}

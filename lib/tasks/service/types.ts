import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { canManageProject, type TaskActor } from "@/lib/tasks/access";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { createTaskTypeSchema, reorderTaskTypesSchema, taskTypeIdSchema, updateTaskTypeSchema } from "@/lib/tasks/schemas";
import { DEFAULT_TASK_TYPES, MAX_TASK_TYPES, type TaskTypeRef } from "@/lib/tasks/taskTypes";
import { findVisibleProject } from "@/lib/projects/service";
import { ARCHIVED_PROJECT } from "./helpers";

/**
 * Per-project task types. Defaults (Task, Bug, Feature) are created lazily the
 * first time a project's types are read; `typeId = null` on a task shows as
 * the project's default type. Managing types needs `canManageProject`.
 */

const typeSelect = { id: true, name: true, tone: true, icon: true, isDefault: true, position: true } satisfies Prisma.ProjectTaskTypeSelect;
const DUPLICATE = "A type with that name already exists.";

/** Create the default types when the project has none (idempotent, race-safe). */
export async function ensureDefaultTaskTypes(workspaceId: string, projectId: string, client: DbClient = prisma): Promise<void> {
  if ((await client.projectTaskType.count({ where: { projectId } })) > 0) return;
  await client.projectTaskType.createMany({
    data: DEFAULT_TASK_TYPES.map((type, position) => ({ workspaceId, projectId, position, ...type })),
    skipDuplicates: true,
  });
}

export async function listTaskTypesFor(workspaceId: string, projectId: string, client: DbClient = prisma): Promise<TaskTypeRef[]> {
  await ensureDefaultTaskTypes(workspaceId, projectId, client);
  return client.projectTaskType.findMany({ where: { workspaceId, projectId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: typeSelect });
}

/** Types plus how many tasks use each (settings screen). The default also counts tasks with no type. */
export async function listTaskTypes(actor: TaskActor, projectId: string): Promise<ActionResult<{ types: Array<TaskTypeRef & { taskCount: number }> }>> {
  const project = await findVisibleProject(actor, { id: projectId });
  if (!project) return actionError(NOT_ALLOWED);
  const types = await listTaskTypesFor(actor.workspace.id, project.id);
  const counts = await prisma.task.groupBy({ by: ["typeId"], where: { projectId: project.id }, _count: { _all: true } });
  const countOf = (typeId: string | null) => counts.find((row) => row.typeId === typeId)?._count._all ?? 0;
  return { ok: true, data: { types: types.map((type) => ({ ...type, taskCount: countOf(type.id) + (type.isDefault ? countOf(null) : 0) })) } };
}

async function loadManaged(actor: TaskActor, typeId: string) {
  const type = await prisma.projectTaskType.findFirst({ where: { id: typeId, workspaceId: actor.workspace.id }, include: { project: true } });
  const project = type ? await findVisibleProject(actor, { id: type.projectId }) : null;
  if (!type || !project || !canManageProject(actor, project)) return { error: NOT_ALLOWED } as const;
  if (project.status === "ARCHIVED") return { error: ARCHIVED_PROJECT } as const;
  return { type, project } as const;
}

async function changed(actor: TaskActor, project: { id: string; teamId: string | null }, action: string, typeId: string | null, metadata: Prisma.InputJsonObject = {}) {
  await recordAuditEvent({ action, workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Project", targetId: project.id, metadata: { typeId, ...metadata } });
  await publishTaskChange({ workspaceId: actor.workspace.id, project, taskIds: [], type: "board.changed", actorId: actor.user.id });
}

/** Names are unique per project ignoring case ("bug" and "Bug" would be ambiguous to people and the assistant). */
async function nameTaken(projectId: string, name: string, exceptId?: string) {
  const row = await prisma.projectTaskType.findFirst({ where: { projectId, name: { equals: name.trim(), mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  return Boolean(row);
}

const isDuplicate = (error: unknown) => (error as { code?: string }).code === "P2002";

export async function createTaskType(actor: TaskActor, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = createTaskTypeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const project = await findVisibleProject(actor, { id: parsed.data.projectId });
  if (!project || !canManageProject(actor, project)) return actionError(NOT_ALLOWED);
  if (project.status === "ARCHIVED") return actionError(ARCHIVED_PROJECT);
  await ensureDefaultTaskTypes(actor.workspace.id, project.id);
  const edge = await prisma.projectTaskType.aggregate({ where: { projectId: project.id }, _max: { position: true }, _count: { _all: true } });
  if (edge._count._all >= MAX_TASK_TYPES) return actionError(`A project can have up to ${MAX_TASK_TYPES} task types. Delete one you don't use first.`);
  if (await nameTaken(project.id, parsed.data.name)) return actionError(DUPLICATE, { name: [DUPLICATE] });
  try {
    const type = await prisma.projectTaskType.create({ data: { workspaceId: actor.workspace.id, projectId: project.id, name: parsed.data.name, tone: parsed.data.tone, icon: parsed.data.icon, position: (edge._max.position ?? -1) + 1 } });
    await changed(actor, project, "project.task_type_created", type.id, { name: type.name });
    return { ok: true, data: { id: type.id } };
  } catch (error) {
    if (isDuplicate(error)) return actionError(DUPLICATE, { name: [DUPLICATE] });
    throw error;
  }
}

export async function updateTaskType(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = updateTaskTypeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadManaged(actor, parsed.data.typeId);
  if (found.error !== undefined) return actionError(found.error);
  const { name, tone, icon } = parsed.data;
  if (name && (await nameTaken(found.project.id, name, found.type.id))) return actionError(DUPLICATE, { name: [DUPLICATE] });
  try {
    await prisma.projectTaskType.update({ where: { id: found.type.id }, data: { name, tone, icon } });
  } catch (error) {
    if (isDuplicate(error)) return actionError(DUPLICATE, { name: [DUPLICATE] });
    throw error;
  }
  await changed(actor, found.project, "project.task_type_updated", found.type.id, { name: name ?? found.type.name });
  return { ok: true };
}

export async function setDefaultTaskType(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = taskTypeIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadManaged(actor, parsed.data.typeId);
  if (found.error !== undefined) return actionError(found.error);
  // Lock the project row so two concurrent changes serialise and exactly one default remains.
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${found.project.id} FOR UPDATE`;
    if (!(await tx.projectTaskType.findFirst({ where: { id: found.type.id, projectId: found.project.id }, select: { id: true } }))) return "gone" as const;
    await tx.projectTaskType.updateMany({ where: { projectId: found.project.id, isDefault: true, id: { not: found.type.id } }, data: { isDefault: false } });
    await tx.projectTaskType.update({ where: { id: found.type.id }, data: { isDefault: true } });
    return "ok" as const;
  });
  if (outcome === "gone") return actionError("That type no longer exists. Reload and try again.");
  await changed(actor, found.project, "project.task_type_default", found.type.id, { name: found.type.name });
  return { ok: true };
}

export async function reorderTaskTypes(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = reorderTaskTypesSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const project = await findVisibleProject(actor, { id: parsed.data.projectId });
  if (!project || !canManageProject(actor, project)) return actionError(NOT_ALLOWED);
  if (project.status === "ARCHIVED") return actionError(ARCHIVED_PROJECT);
  const existing = await prisma.projectTaskType.findMany({ where: { projectId: project.id }, select: { id: true } });
  const ids = parsed.data.typeIds;
  if (ids.length !== existing.length || !existing.every((type) => ids.includes(type.id))) return actionError("The type list changed. Reload and try again.");
  await prisma.$transaction(ids.map((id, position) => prisma.projectTaskType.update({ where: { id }, data: { position } })));
  await changed(actor, project, "project.task_types_reordered", null);
  return { ok: true };
}

export async function deleteTaskType(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = taskTypeIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadManaged(actor, parsed.data.typeId);
  if (found.error !== undefined) return actionError(found.error);
  if (found.type.isDefault) return actionError("Make another type the default before deleting this one.");
  const used = await prisma.task.count({ where: { typeId: found.type.id } });
  if (used > 0) return actionError(`Move ${used} ${used === 1 ? "task" : "tasks"} to another type first.`);
  await prisma.projectTaskType.deleteMany({ where: { id: found.type.id, isDefault: false } });
  await changed(actor, found.project, "project.task_type_deleted", found.type.id, { name: found.type.name });
  return { ok: true };
}

/** A type id that belongs to the project (for create/update/transfer). */
export async function resolveTypeForProject(workspaceId: string, projectId: string, typeId: string, client: DbClient = prisma): Promise<TaskTypeRef | null> {
  await ensureDefaultTaskTypes(workspaceId, projectId, client);
  return client.projectTaskType.findFirst({ where: { id: typeId, workspaceId, projectId }, select: typeSelect });
}

export async function defaultTaskType(workspaceId: string, projectId: string, client: DbClient = prisma): Promise<TaskTypeRef | null> {
  return (await listTaskTypesFor(workspaceId, projectId, client)).find((type) => type.isDefault) ?? null;
}

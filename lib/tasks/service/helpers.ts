import "server-only";
import type { Prisma, Project, Task } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { NOT_ALLOWED } from "@/lib/actionResult";
import { dispatch } from "@/lib/notify";
import type { EventPayloads, NotificationEvent } from "@/lib/notify";
import {
  assignableMembers,
  canEditTasks,
  projectViewerIds,
  visibleTaskWhere,
  type TaskActor,
} from "@/lib/tasks/access";
import {
  ALREADY_CLAIMED_MESSAGE,
  RESTRICTED_EDIT_MESSAGE,
  canPerformTaskAction,
  type TaskAction,
  type TaskCapabilityInput,
  type TaskSource,
} from "@/lib/tasks/capabilities";
import { taskUrl } from "@/lib/tasks/links";

export type Tx = Prisma.TransactionClient;
export type After = Array<() => Promise<void>>;
export type LoadedTask = Task & { project: Project | null };

export const ARCHIVED_PROJECT = "This project is archived. Restore it to make changes.";
export const ARCHIVED_TASK = "This task is archived. Restore it to make changes.";
export const CHANGED_MESSAGE = "This task changed. Refresh and try again.";
export const NOT_FOUND = "That task doesn't exist or you can't see it.";

export async function loadVisibleTask(actor: TaskActor, taskId: string, client: DbClient = prisma): Promise<LoadedTask | null> {
  return client.task.findFirst({ where: { AND: [await visibleTaskWhere(actor, client), { id: taskId }] }, include: { project: true } });
}

/** Capability input for one task as the actor sees it (assignee ids come from the caller's read). */
export function capabilityInput(actor: TaskActor, task: LoadedTask, assigneeIds: readonly string[]): TaskCapabilityInput {
  return {
    role: actor.membership.role,
    userId: actor.user.id,
    restrictTaskEdits: task.project?.restrictTaskEdits ?? false,
    projectOwnerId: task.project?.ownerId ?? null,
    creatorId: task.creatorId,
    assigneeIds,
  };
}

/** The edit gate for tasks touched indirectly (cycle membership, milestone links): fresh assignees, same rules as an edit. */
export async function canEditTaskInTx(tx: Tx, actor: TaskActor, tasks: ReadonlyArray<{ id: string; creatorId: string | null }>, project: { restrictTaskEdits: boolean; ownerId: string | null } | null): Promise<boolean> {
  if (!canEditTasks(actor)) return false;
  if (!project?.restrictTaskEdits || tasks.length === 0) return true;
  const rows = await tx.taskAssignee.findMany({ where: { taskId: { in: tasks.map((task) => task.id) } }, select: { taskId: true, userId: true } });
  return tasks.every((task) =>
    canPerformTaskAction("edit", {
      role: actor.membership.role,
      userId: actor.user.id,
      restrictTaskEdits: true,
      projectOwnerId: project.ownerId,
      creatorId: task.creatorId,
      assigneeIds: rows.filter((row) => row.taskId === task.id).map((row) => row.userId),
    }),
  );
}

/** Why `action` was refused, as a short UI-safe sentence. */
export function deniedMessage(action: TaskAction, input: TaskCapabilityInput): string {
  if (!canEditTasks({ membership: { role: input.role } } as TaskActor)) return NOT_ALLOWED;
  if (action === "edit") return RESTRICTED_EDIT_MESSAGE;
  if (action === "claim") return ALREADY_CLAIMED_MESSAGE;
  return NOT_ALLOWED;
}

/**
 * Load a task the actor may act on: visible, live project, not archived
 * unless allowed, and permitted for `action` (see lib/tasks/capabilities).
 * Assignment actions re-check inside their transaction after the row lock.
 */
export async function loadEditableTask(
  actor: TaskActor,
  taskId: string,
  options: { action: TaskAction; allowArchived?: boolean },
): Promise<{ task: LoadedTask; assigneeIds: string[] } | { error: string }> {
  if (!canEditTasks(actor)) return { error: NOT_ALLOWED };
  const task = await loadVisibleTask(actor, taskId);
  if (!task) return { error: NOT_FOUND };
  if (task.project?.status === "ARCHIVED") return { error: ARCHIVED_PROJECT };
  if (task.archivedAt && !options.allowArchived) return { error: ARCHIVED_TASK };
  const assigneeIds = (await prisma.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } })).map((row) => row.userId);
  const input = capabilityInput(actor, task, assigneeIds);
  if (!canPerformTaskAction(options.action, input)) return { error: deniedMessage(options.action, input) };
  return { task, assigneeIds };
}

/** Serialise assignment changes on one task (house pattern: SELECT ... FOR UPDATE). */
export async function lockTask(tx: Tx, taskId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`;
}

export const actorName = (actor: TaskActor) => actor.user.name ?? "Someone";

export function eventBase(actor: TaskActor, task: Pick<Task, "id" | "number" | "projectId">, project: Pick<Project, "id" | "key"> | null) {
  return {
    url: taskUrl(actor.workspace.slug, project?.key, task.number),
    actorId: actor.user.id,
    resource: { type: "task", id: task.id },
    scope: { taskId: task.id, ...(project ? { projectId: project.id } : {}) },
    data: { taskId: task.id, taskNumber: task.number, projectId: task.projectId },
  };
}

export async function notify<T extends keyof EventPayloads>(tx: Tx, after: After, workspaceId: string, event: NotificationEvent<T>) {
  const result = await dispatch(workspaceId, event, { tx });
  after.push(result.afterCommit);
}

export async function runAfter(after: After) {
  for (const fn of after) await fn().catch(() => undefined);
}

/** Provenance stored in TaskActivity.data: `source` (default web) and an optional `client` label. */
export const viaOf = (actor: TaskActor) => actor.via ?? { source: "web" as const };

export async function addHistory(tx: Tx, taskId: string, actorId: string | null, kind: string, data?: Prisma.InputJsonValue, via?: { source: TaskSource; client?: string }) {
  const merged = via ? { ...((data ?? {}) as Prisma.InputJsonObject), source: via.source, ...(via.client ? { client: via.client.slice(0, 80) } : {}) } : data;
  await tx.taskActivity.create({ data: { taskId, actorId, kind, ...(merged === undefined ? {} : { data: merged }) } });
}

export async function validateAssignees(actor: TaskActor, project: { teamId: string | null } | null, userIds: string[], client: DbClient) {
  if (userIds.length === 0) return { ok: true as const, userIds };
  const allowed = new Set((await assignableMembers(actor.workspace.id, project, client)).map((person) => person.id));
  if (!userIds.every((id) => allowed.has(id))) return { ok: false as const };
  return { ok: true as const, userIds };
}

export async function validateLabels(actor: TaskActor, labelIds: string[], client: DbClient) {
  if (labelIds.length === 0) return { ok: true as const, labels: [] as Array<{ id: string; name: string }> };
  const labels = await client.label.findMany({ where: { workspaceId: actor.workspace.id, id: { in: labelIds } }, select: { id: true, name: true } });
  return labels.length === labelIds.length ? { ok: true as const, labels } : { ok: false as const };
}

/** Recipients who can still see the task (creator may have left a private team). */
export async function visibleRecipients(tx: Tx, workspaceId: string, project: { teamId: string | null } | null, userIds: Array<string | null | undefined>) {
  const viewers = await projectViewerIds(workspaceId, project, tx);
  return [...new Set(userIds.filter((id): id is string => Boolean(id) && viewers.has(id as string)))];
}

import "server-only";
import type { Prisma, Project } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assignableMembers, visibleTaskWhere, type TaskActor } from "@/lib/tasks/access";
import type { BoardData, BoardTask } from "@/lib/tasks/types";
import { effectiveType, type TaskTypeRef } from "@/lib/tasks/taskTypes";
import { listTaskTypesFor } from "@/lib/tasks/service/types";
import { iso } from "./formatters";
import {
  permissionsFor,
  projectSummary,
  workspaceLabels,
  findProjectByKey,
  taskRights,
} from "./projects";

const boardTaskSelect = {
  id: true,
  number: true,
  title: true,
  priority: true,
  dueAt: true,
  completedAt: true,
  columnId: true,
  typeId: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  recurrenceId: true,
  creatorId: true,
  blockerReason: true,
  assignees: { select: { userId: true }, orderBy: { assignedAt: "asc" } },
  labels: { select: { labelId: true } },
  blockedBy: { where: { type: "BLOCKS", blockingTask: { completedAt: null, archivedAt: null } }, select: { blockingTaskId: true } },
  _count: {
    select: {
      subtasks: { where: { archivedAt: null } },
      comments: { where: { deletedAt: null } },
      files: { where: { deletedAt: null } },
      recurrenceRules: { where: { active: true } },
    },
  },
} satisfies Prisma.TaskSelect;

type BoardTaskRow = Prisma.TaskGetPayload<{ select: typeof boardTaskSelect }>;

async function toBoardTasks(actor: TaskActor, project: Project, rows: BoardTaskRow[], types: TaskTypeRef[]): Promise<BoardTask[]> {
  const done = rows.length
    ? await prisma.task.groupBy({ by: ["parentId"], where: { parentId: { in: rows.map((row) => row.id) }, archivedAt: null, completedAt: { not: null } }, _count: { _all: true } })
    : [];
  const doneBy = new Map(done.map((row) => [row.parentId, row._count._all]));
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    priority: row.priority,
    dueAt: iso(row.dueAt),
    completedAt: iso(row.completedAt),
    columnId: row.columnId,
    typeId: effectiveType(types, row.typeId)?.id ?? null,
    position: row.position,
    assigneeIds: row.assignees.map((a) => a.userId),
    labelIds: row.labels.map((l) => l.labelId),
    ...taskRights(actor, { creatorId: row.creatorId, project }, row.assignees.map((a) => a.userId)),
    subtaskCount: row._count.subtasks,
    subtaskDone: doneBy.get(row.id) ?? 0,
    commentCount: row._count.comments,
    attachmentCount: row._count.files,
    blocked: Boolean(row.blockerReason) || row.blockedBy.length > 0,
    recurring: Boolean(row.recurrenceId) || row._count.recurrenceRules > 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getBoardData(actor: TaskActor, key: string): Promise<BoardData | null> {
  const project = await findProjectByKey(actor, key);
  if (!project) return null;
  const [summary, columns, rows, members, labels, taskTypes] = await Promise.all([
    projectSummary(project),
    prisma.boardColumn.findMany({ where: { projectId: project.id }, orderBy: { position: "asc" }, select: { id: true, name: true, position: true, category: true } }),
    prisma.task.findMany({ where: { projectId: project.id, parentId: null, archivedAt: null }, orderBy: [{ position: "asc" }, { number: "asc" }], select: boardTaskSelect, take: 2000 }),
    assignableMembers(actor.workspace.id, project),
    workspaceLabels(actor.workspace.id),
    listTaskTypesFor(actor.workspace.id, project.id),
  ]);
  return { project: summary, columns, tasks: await toBoardTasks(actor, project, rows, taskTypes), members, labels, taskTypes, permissions: permissionsFor(actor, project) };
}

/** Archived tasks of a project, newest first (for the "Archived" view). */
export async function listArchivedTasks(actor: TaskActor, projectId: string) {
  return prisma.task.findMany({
    where: { AND: [await visibleTaskWhere(actor), { projectId, archivedAt: { not: null }, parentId: null }] },
    orderBy: { archivedAt: "desc" },
    take: 100,
    select: { id: true, number: true, title: true, archivedAt: true },
  });
}

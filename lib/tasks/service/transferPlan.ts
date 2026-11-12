import "server-only";
import type { ColumnCategory, Project, Task } from "@prisma/client";
import type { DbClient } from "@/lib/db";
import { assignableMembers } from "@/lib/tasks/access";
import { effectiveType } from "@/lib/tasks/taskTypes";
import { listTaskTypesFor } from "./types";

/** What moving a task (and its subtasks) to another project changes. Shared by the preview and the transfer. */

export type TransferPlan = {
  target: Project;
  targetColumn: { id: string; name: string; category: ColumnCategory } | null;
  /** Type name carried over (null when the target has no type of that name). */
  typeId: string | null;
  typeName: string | null;
  typeKept: boolean;
  /** Task ids (parent first, then subtasks) mapped to the assignee ids that cannot follow. */
  dropped: Map<string, string[]>;
  taskIds: string[];
  milestoneLinks: number;
  clearsCycle: boolean;
};

type Moving = Pick<Task, "id" | "workspaceId" | "projectId" | "columnId" | "typeId" | "completedAt" | "cycleId">;

export async function planTransfer(db: DbClient, task: Moving, target: Project, sourceProjectId: string | null): Promise<TransferPlan> {
  const subtasks = await db.task.findMany({ where: { parentId: task.id }, select: { id: true, cycleId: true } });
  const taskIds = [task.id, ...subtasks.map((row) => row.id)];
  const [columns, targetTypes, sourceTypes, sourceColumn, assignable, assignees, milestoneLinks] = await Promise.all([
    db.boardColumn.findMany({ where: { projectId: target.id }, orderBy: { position: "asc" }, select: { id: true, name: true, category: true } }),
    listTaskTypesFor(task.workspaceId, target.id, db),
    sourceProjectId ? listTaskTypesFor(task.workspaceId, sourceProjectId, db) : Promise.resolve([]),
    task.columnId ? db.boardColumn.findUnique({ where: { id: task.columnId }, select: { category: true } }) : Promise.resolve(null),
    assignableMembers(task.workspaceId, target, db),
    db.taskAssignee.findMany({ where: { taskId: { in: taskIds } }, select: { taskId: true, userId: true } }),
    db.projectMilestoneTask.count({ where: { workspaceId: task.workspaceId, taskId: { in: taskIds } } }),
  ]);
  const category: ColumnCategory = sourceColumn?.category ?? (task.completedAt ? "DONE" : "TODO");
  const targetColumn = columns.find((column) => column.category === category) ?? columns.find((column) => column.category === "TODO") ?? columns[0] ?? null;
  const sourceName = effectiveType(sourceTypes, task.typeId)?.name.toLowerCase();
  const match = sourceName ? targetTypes.find((type) => type.name.toLowerCase() === sourceName) : undefined;
  const allowed = new Set(assignable.map((person) => person.id));
  const dropped = new Map<string, string[]>();
  for (const id of taskIds) dropped.set(id, assignees.filter((row) => row.taskId === id && !allowed.has(row.userId)).map((row) => row.userId));
  return {
    target,
    targetColumn,
    typeId: match?.id ?? null,
    typeName: match?.name ?? null,
    typeKept: Boolean(match) || !sourceName,
    dropped,
    taskIds,
    milestoneLinks,
    clearsCycle: Boolean(task.cycleId) || subtasks.some((row) => row.cycleId),
  };
}

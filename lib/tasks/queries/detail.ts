import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import { hasRoleAtLeast } from "@/lib/roles";
import { assignableMembers, visibleTaskWhere, type TaskActor } from "@/lib/tasks/access";
import { activityText, HIDDEN_ACTIVITY_KINDS } from "@/lib/tasks/activityText";
import { taskReference, taskUrl } from "@/lib/tasks/links";
import { describeRule, parseAssigneeRule, parseRRule } from "@/lib/tasks/recurrence";
import { effectiveType } from "@/lib/tasks/taskTypes";
import { listTaskTypesFor } from "@/lib/tasks/service/types";
import type {
  ColumnDTO,
  PersonRef,
  TaskDetailDTO,
  TaskRef,
} from "@/lib/tasks/types";
import { iso, dateOnly } from "./formatters";
import { permissionsFor, projectSummary, taskRights, workspaceLabels } from "./projects";

async function people(ids: Iterable<string>): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, image: true } });
  return new Map(users.map((user) => [user.id, user]));
}

function ref(task: { id: string; number: number; title: string; completedAt: Date | null; archivedAt: Date | null; project: { key: string } | null }): TaskRef {
  return { id: task.id, number: task.number, title: task.title, projectKey: task.project?.key ?? null, completedAt: iso(task.completedAt), archivedAt: iso(task.archivedAt) };
}

const refSelect = { id: true, number: true, title: true, completedAt: true, archivedAt: true, project: { select: { key: true } } } satisfies Prisma.TaskSelect;

export async function findVisibleTaskByNumber(actor: TaskActor, number: number) {
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return prisma.task.findFirst({ where: { AND: [await visibleTaskWhere(actor), { number }] }, include: { project: true } });
}

export async function getTaskDetail(actor: TaskActor, number: number): Promise<TaskDetailDTO | null> {
  const visible = await visibleTaskWhere(actor);
  const task = await prisma.task.findFirst({
    where: { AND: [visible, { number }] },
    include: {
      project: true,
      parent: { select: refSelect },
      assignees: { select: { user: { select: { id: true, name: true, image: true } } }, orderBy: { assignedAt: "asc" } },
      labels: { select: { labelId: true } },
      subtasks: { where: { archivedAt: null }, orderBy: [{ position: "asc" }, { number: "asc" }], select: { ...refSelect, assignees: { select: { user: { select: { id: true, name: true, image: true } } } } } },
      blockedBy: { where: { type: "BLOCKS" }, select: { blockingTask: { select: refSelect } } },
      blocking: { where: { type: "BLOCKS" }, select: { blockedTask: { select: refSelect } } },
      comments: { orderBy: { createdAt: "asc" }, take: 300, select: { id: true, authorId: true, body: true, createdAt: true, editedAt: true, deletedAt: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 100, select: { id: true, actorId: true, kind: true, data: true, createdAt: true } },
      files: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, filename: true, size: true, contentType: true, uploadedById: true, createdAt: true } },
      recurrenceRules: { orderBy: [{ active: "desc" }, { updatedAt: "desc" }], take: 1 },
      recurrence: true,
    },
  });
  if (!task) return null;
  const project = task.project;
  const linkedIds = [...task.blockedBy.map((row) => row.blockingTask.id), ...task.blocking.map((row) => row.blockedTask.id)];
  const visibleLinked = linkedIds.length
    ? new Set((await prisma.task.findMany({ where: { AND: [visible, { id: { in: linkedIds } }] }, select: { id: true } })).map((row) => row.id))
    : new Set<string>();
  const rule = task.recurrenceRules[0] ?? task.recurrence ?? null;
  const personIds = [
    task.creatorId ?? "",
    ...task.comments.map((comment) => comment.authorId ?? ""),
    ...task.activities.map((activity) => activity.actorId ?? ""),
    ...task.files.map((file) => file.uploadedById ?? ""),
    ...task.activities.flatMap((activity) => {
      const data = activity.data as { userIds?: unknown; droppedAssignees?: unknown } | null;
      return [data?.userIds, data?.droppedAssignees].flatMap((value) => (Array.isArray(value) ? (value as string[]) : []));
    }),
    ...task.comments.flatMap((comment) => [...comment.body.matchAll(/<@([A-Za-z0-9_-]{1,64})>/g)].map((match) => match[1]!)),
    ...(rule ? parseAssigneeRule(rule.assigneeRule).userIds : []),
  ];
  const [peopleMap, columns, members, labels, summary, taskTypes] = await Promise.all([
    people(personIds),
    project ? prisma.boardColumn.findMany({ where: { projectId: project.id }, orderBy: { position: "asc" }, select: { id: true, name: true, position: true, category: true } }) : Promise.resolve([] as ColumnDTO[]),
    assignableMembers(actor.workspace.id, project),
    workspaceLabels(actor.workspace.id),
    project ? projectSummary(project) : Promise.resolve(null),
    project ? listTaskTypesFor(actor.workspace.id, project.id) : Promise.resolve([]),
  ]);
  const nameOf = (id: string) => peopleMap.get(id)?.name ?? members.find((member) => member.id === id)?.name ?? "a former member";
  const isAdmin = hasRoleAtLeast(actor.membership.role, "ADMIN");
  const rights = taskRights(actor, { creatorId: task.creatorId, project }, task.assignees.map((row) => row.user.id));
  const permissions = { ...permissionsFor(actor, project), canEdit: rights.canEdit };
  const pattern = rule ? parseRRule(rule.rrule) : null;
  const assigneeRule = rule ? parseAssigneeRule(rule.assigneeRule) : null;

  return {
    id: task.id,
    number: task.number,
    title: task.title,
    description: task.description,
    startsOn: dateOnly(task.startsOn),
    blockerReason: task.blockerReason,
    blockerOwnerId: task.blockerOwnerId,
    priority: task.priority,
    dueAt: iso(task.dueAt),
    completedAt: iso(task.completedAt),
    archivedAt: iso(task.archivedAt),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    creator: task.creatorId ? (peopleMap.get(task.creatorId) ?? null) : null,
    columnId: task.columnId,
    typeId: effectiveType(taskTypes, task.typeId)?.id ?? null,
    taskTypes,
    project: summary,
    columns,
    parent: task.parent ? ref(task.parent) : null,
    assignees: task.assignees.map((row) => row.user),
    labelIds: task.labels.map((row) => row.labelId),
    subtasks: task.subtasks.map((subtask) => ({ ...ref(subtask), assignees: subtask.assignees.map((row) => row.user) })),
    blockedBy: task.blockedBy.filter((row) => visibleLinked.has(row.blockingTask.id)).map((row) => ref(row.blockingTask)),
    blocks: task.blocking.filter((row) => visibleLinked.has(row.blockedTask.id)).map((row) => ref(row.blockedTask)),
    comments: task.comments.map((comment) => ({
      id: comment.id,
      author: comment.authorId ? (peopleMap.get(comment.authorId) ?? null) : null,
      body: comment.deletedAt ? "" : comment.body,
      createdAt: comment.createdAt.toISOString(),
      editedAt: iso(comment.editedAt),
      deleted: Boolean(comment.deletedAt),
      canEdit: !comment.deletedAt && (comment.authorId === actor.user.id || isAdmin),
    })),
    activity: task.activities
      .filter((activity) => !HIDDEN_ACTIVITY_KINDS.has(activity.kind))
      .map((activity) => ({
        id: activity.id,
        actor: activity.actorId ? (peopleMap.get(activity.actorId) ?? null) : null,
        kind: activity.kind,
        text: activityText(activity.kind, activity.data as Record<string, unknown> | null, { nameOf, timeZone: actor.workspace.timezone }),
        createdAt: activity.createdAt.toISOString(),
      })),
    attachments: task.files.map((file) => ({
      id: file.id,
      filename: file.filename,
      size: file.size,
      contentType: file.contentType,
      url: fileUrl(file.id),
      uploadedBy: file.uploadedById ? (peopleMap.get(file.uploadedById) ?? null) : null,
      createdAt: file.createdAt.toISOString(),
      canDelete: permissions.canEdit && (file.uploadedById === actor.user.id || permissions.canManage),
    })),
    recurrence:
      rule && pattern && assigneeRule
        ? {
            id: rule.id,
            rrule: rule.rrule,
            description: describeRule(pattern),
            createMode: rule.createMode,
            assigneeMode: assigneeRule.type,
            assigneeIds: assigneeRule.userIds,
            dueOffsetDays: rule.dueOffsetDays,
            nextRunAt: iso(rule.nextRunAt),
            active: rule.active,
            isTemplate: rule.templateTaskId === task.id,
          }
        : null,
    members,
    labels,
    permissions,
    canClaim: rights.canClaim,
    canUnclaim: rights.canUnclaim,
    isAssignedToMe: rights.isAssignedToMe,
    url: taskUrl(actor.workspace.slug, project?.key, task.number),
    reference: taskReference(project?.key, task.number),
    timeZone: actor.workspace.timezone,
    viewerId: actor.user.id,
  };
}

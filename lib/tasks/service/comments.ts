import "server-only";
import { prisma } from "@/lib/db";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import {
  actionError,
  NOT_ALLOWED,
  validationError,
  type ActionResult,
} from "@/lib/actionResult";
import { hasRoleAtLeast } from "@/lib/roles";
import { type TaskActor } from "@/lib/tasks/access";
import { taskReference } from "@/lib/tasks/links";
import { extractMentionIds } from "@/lib/tasks/mentions";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { addCommentSchema, commentIdSchema, editCommentSchema } from "@/lib/tasks/schemas";
import {
  type Tx,
  type After,
  type LoadedTask,
  ARCHIVED_TASK,
  NOT_FOUND,
  actorName,
  eventBase,
  notify,
  runAfter,
  addHistory,
  viaOf,
  visibleRecipients,
  loadVisibleTask,
} from "./helpers";

/* ---------- Comments and mentions ---------- */

async function commentTarget(actor: TaskActor, taskId: string) {
  const task = await loadVisibleTask(actor, taskId);
  if (!task) return { error: NOT_FOUND } as const;
  if (task.archivedAt) return { error: ARCHIVED_TASK } as const;
  return { task } as const;
}

/** Keep only mentions of people who can see the task; unknown tokens are left as text. */
async function mentionRecipients(tx: Tx, actor: TaskActor, task: LoadedTask, body: string) {
  const ids = extractMentionIds(body);
  if (ids.length === 0) return [];
  return visibleRecipients(tx, actor.workspace.id, task.project, ids);
}

export async function addComment(actor: TaskActor, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = addCommentSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await commentTarget(actor, parsed.data.taskId);
  if (found.error) return actionError(found.error);
  const { task } = found;
  const after: After = [];
  const ref = taskReference(task.project?.key, task.number);
  const comment = await prisma.$transaction(async (tx) => {
    const comment = await tx.taskComment.create({ data: { taskId: task.id, authorId: actor.user.id, body: parsed.data.body } });
    await tx.task.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
    await addHistory(tx, task.id, actor.user.id, "commented", undefined, viaOf(actor));
    await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "commented", entityType: "task", entityId: task.id, summary: `commented on ${ref} ${task.title}`, projectId: task.projectId, teamId: task.project?.teamId ?? null }, tx);
    const base = eventBase(actor, task, task.project);
    const mentioned = (await mentionRecipients(tx, actor, task, parsed.data.body)).filter((id) => id !== actor.user.id);
    if (mentioned.length > 0) {
      await notify(tx, after, actor.workspace.id, {
        ...base,
        type: "mention",
        title: `${actorName(actor)} mentioned you on ${ref}: ${task.title}`,
        recipients: mentioned,
        data: { sourceType: "task_comment", sourceId: comment.id, channelId: null },
      });
    }
    const assigneeIds = (await tx.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } })).map((row) => row.userId);
    const watchers = (await visibleRecipients(tx, actor.workspace.id, task.project, [...assigneeIds, task.creatorId])).filter((id) => id !== actor.user.id && !mentioned.includes(id));
    if (watchers.length > 0) {
      await notify(tx, after, actor.workspace.id, {
        ...base,
        type: "task.commented",
        title: `${actorName(actor)} commented on ${ref}: ${task.title}`,
        recipients: watchers,
        data: { ...base.data, commentId: comment.id },
      });
    }
    return comment;
  });
  await runAfter(after);
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "comment.changed", actorId: actor.user.id });
  return { ok: true, data: { id: comment.id } };
}

async function ownComment(actor: TaskActor, commentId: string, options: { adminMayAct: boolean }) {
  const comment = await prisma.taskComment.findFirst({ where: { id: commentId, deletedAt: null, task: { workspaceId: actor.workspace.id } } });
  if (!comment) return { error: "That comment doesn't exist any more." } as const;
  const task = await loadVisibleTask(actor, comment.taskId);
  if (!task) return { error: NOT_FOUND } as const;
  const isAuthor = comment.authorId === actor.user.id;
  if (!isAuthor && !(options.adminMayAct && hasRoleAtLeast(actor.membership.role, "ADMIN"))) return { error: NOT_ALLOWED } as const;
  return { comment, task } as const;
}

export async function editComment(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = editCommentSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await ownComment(actor, parsed.data.commentId, { adminMayAct: false });
  if (found.error) return actionError(found.error);
  const { comment, task } = found;
  if (comment.body === parsed.data.body) return { ok: true };
  const after: After = [];
  await prisma.$transaction(async (tx) => {
    await tx.taskComment.update({ where: { id: comment.id }, data: { body: parsed.data.body, editedAt: new Date() } });
    const before = new Set(extractMentionIds(comment.body));
    const fresh = (await mentionRecipients(tx, actor, task, parsed.data.body)).filter((id) => !before.has(id) && id !== actor.user.id);
    if (fresh.length > 0) {
      const ref = taskReference(task.project?.key, task.number);
      await notify(tx, after, actor.workspace.id, {
        ...eventBase(actor, task, task.project),
        type: "mention",
        title: `${actorName(actor)} mentioned you on ${ref}: ${task.title}`,
        recipients: fresh,
        data: { sourceType: "task_comment", sourceId: comment.id, channelId: null },
      });
    }
  });
  await runAfter(after);
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "comment.changed", actorId: actor.user.id });
  return { ok: true };
}

export async function deleteComment(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = commentIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await ownComment(actor, parsed.data.commentId, { adminMayAct: true });
  if (found.error) return actionError(found.error);
  const { comment, task } = found;
  await prisma.$transaction(async (tx) => {
    await tx.taskComment.update({ where: { id: comment.id }, data: { deletedAt: new Date(), body: "" } });
    await recordAuditEvent({ action: "task.comment_deleted", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "TaskComment", targetId: comment.id, metadata: { taskId: task.id, byAuthor: comment.authorId === actor.user.id }, client: tx });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "comment.changed", actorId: actor.user.id });
  return { ok: true };
}

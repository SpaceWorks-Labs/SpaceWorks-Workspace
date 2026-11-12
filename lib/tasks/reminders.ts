import "server-only";

import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { projectViewerIds } from "@/lib/tasks/access";
import { DAY_MS } from "@/lib/tasks/localDate";
import { reminderDue } from "@/lib/tasks/due";
import { taskReference, taskUrl } from "@/lib/tasks/links";

/**
 * Due and overdue reminders for assignees: "due today" at 9 AM on the due
 * day and "overdue" at 9 AM the day after, once per task and due date.
 * Exactly-once across replicas: each send runs in a transaction that first
 * takes a per-reminder advisory lock (others skip it) and then checks for
 * an earlier event with the same dedupe key.
 */
export async function sendDueReminders(now: Date = new Date(), limit = 500): Promise<number> {
  const tasks = await prisma.task.findMany({
    where: {
      completedAt: null,
      archivedAt: null,
      dueAt: { gte: new Date(now.getTime() - 10 * DAY_MS), lte: new Date(now.getTime() + DAY_MS) },
      assignees: { some: {} },
      workspace: { status: "ACTIVE", archivedAt: null },
      OR: [{ projectId: null }, { project: { status: { not: "ARCHIVED" } } }],
    },
    orderBy: { dueAt: "asc" },
    take: limit,
    select: {
      id: true,
      number: true,
      title: true,
      dueAt: true,
      projectId: true,
      workspace: { select: { id: true, slug: true, timezone: true } },
      project: { select: { id: true, key: true, teamId: true } },
      assignees: { select: { userId: true } },
    },
  });
  const viewerCache = new Map<string, Set<string>>();
  let sent = 0;
  for (const task of tasks) {
    const kind = reminderDue(task.dueAt!, now, task.workspace.timezone);
    if (!kind) continue;
    const dedupeKey = `task.${kind}:${task.id}:${task.dueAt!.toISOString()}`;
    if (await prisma.notificationEventRecord.findFirst({ where: { workspaceId: task.workspace.id, dedupeKey }, select: { id: true } })) continue;
    const cacheKey = `${task.workspace.id}:${task.project?.teamId ?? ""}`;
    let viewers = viewerCache.get(cacheKey);
    if (!viewers) {
      viewers = await projectViewerIds(task.workspace.id, task.project);
      viewerCache.set(cacheKey, viewers);
    }
    const recipients = task.assignees.map((row) => row.userId).filter((id) => viewers!.has(id));
    if (recipients.length === 0) continue;
    const ref = taskReference(task.project?.key, task.number);
    const result = await prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${dedupeKey})) AS locked`;
      if (!locked) return null;
      const earlier = await tx.notificationEventRecord.findFirst({ where: { workspaceId: task.workspace.id, dedupeKey }, select: { id: true } });
      if (earlier) return null;
      return dispatch(
        task.workspace.id,
        {
          type: kind === "due" ? "task.due" : "task.overdue",
          title: kind === "due" ? `${ref} is due today: ${task.title}` : `${ref} is overdue: ${task.title}`,
          url: taskUrl(task.workspace.slug, task.project?.key, task.number),
          actorId: null,
          recipients,
          resource: { type: "task", id: task.id },
          scope: { taskId: task.id, ...(task.project ? { projectId: task.project.id } : {}) },
          dedupeKey,
          dedupeWindowSec: 14 * 24 * 3600,
          data: { taskId: task.id, taskNumber: task.number, projectId: task.projectId, dueAt: task.dueAt!.toISOString() },
        },
        { tx },
      );
    });
    if (result) {
      await result.afterCommit().catch(() => undefined);
      sent += 1;
    }
  }
  return sent;
}

import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { visibleTaskWhere, type TaskActor } from "@/lib/tasks/access";
import { taskUrl } from "@/lib/tasks/links";
import type { MyTaskItem, MyTasksTab } from "@/lib/tasks/myTasks";
import { iso } from "./formatters";
import { taskRights } from "./projects";

/**
 * Active people who report to the actor. `MemberProfile.managerId` holds the
 * manager's user id (lib/orgPeople). Disabled users and inactive memberships
 * are left out.
 */
export async function directReportIds(actor: TaskActor): Promise<string[]> {
  const profiles = await prisma.memberProfile.findMany({ where: { workspaceId: actor.workspace.id, managerId: actor.user.id }, select: { userId: true } });
  if (profiles.length === 0) return [];
  const active = await prisma.membership.findMany({
    where: { workspaceId: actor.workspace.id, status: "ACTIVE", userId: { in: profiles.map((profile) => profile.userId) }, user: { disabledAt: null } },
    select: { userId: true },
  });
  return active.map((row) => row.userId).filter((id) => id !== actor.user.id);
}

/** What each tab selects (visibility is added by the caller). */
async function tabWhere(actor: TaskActor, tab: MyTasksTab): Promise<Prisma.TaskWhereInput | null> {
  const me = actor.user.id;
  switch (tab) {
    case "assigned":
      return { assignees: { some: { userId: me } } };
    case "assigned-by-me":
      // Rows that predate `assignedById` fall back to "I created it".
      return {
        OR: [{ assignees: { some: { assignedById: me, userId: { not: me } } } }, { creatorId: me, recurrenceId: null, assignees: { some: { assignedById: null, userId: { not: me } } } }],
      };
    case "created":
      return { creatorId: me };
    case "team": {
      const reports = await directReportIds(actor);
      return reports.length ? { assignees: { some: { userId: { in: reports } } } } : null;
    }
  }
}

/** Open tasks for a My Tasks tab, plus those finished in the last 12 hours (so a quick complete can be undone). */
export async function listMyTasks(actor: TaskActor, now: Date = new Date(), tab: MyTasksTab = "assigned"): Promise<MyTaskItem[]> {
  const scope = await tabWhere(actor, tab);
  if (!scope) return [];
  const rows = await prisma.task.findMany({
    where: {
      AND: [
        await visibleTaskWhere(actor),
        { archivedAt: null },
        scope,
        { OR: [{ completedAt: null }, { completedAt: { gte: new Date(now.getTime() - 12 * 3_600_000) } }] },
        { OR: [{ projectId: null }, { project: { status: { not: "ARCHIVED" } } }] },
      ],
    },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { number: "desc" }],
    take: 500,
    select: {
      id: true,
      number: true,
      title: true,
      priority: true,
      dueAt: true,
      blockerReason: true,
      completedAt: true,
      creatorId: true,
      assignees: { select: { userId: true, user: { select: { id: true, name: true, image: true } } } },
      project: { select: { key: true, name: true, ownerId: true, status: true, restrictTaskEdits: true } },
      labels: { select: { labelId: true } },
      blockedBy: { where: { type: "BLOCKS", blockingTask: { completedAt: null, archivedAt: null } }, select: { blockingTaskId: true } },
    },
  });
  return rows.map((row) => {
    const rights = taskRights(actor, row, row.assignees.map((a) => a.userId));
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      priority: row.priority,
      dueAt: iso(row.dueAt),
      completedAt: iso(row.completedAt),
      projectKey: row.project?.key ?? null,
      projectName: row.project?.name ?? null,
      labelIds: row.labels.map((l) => l.labelId),
      blocked: Boolean(row.blockerReason) || row.blockedBy.length > 0,
      canEdit: rights.canEdit,
      canClaim: rights.canClaim,
      isAssignedToMe: rights.isAssignedToMe,
      url: taskUrl(actor.workspace.slug, row.project?.key, row.number),
      assignees: row.assignees.map((a) => ({ id: a.user.id, name: a.user.name, image: a.user.image })),
    };
  });
}

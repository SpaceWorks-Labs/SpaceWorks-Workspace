import "server-only";
import type { Prisma, Workspace } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canContribute, type RoleHolder } from "@/lib/roles";
import { getWorkspaceModules } from "@/lib/limits/modules";
import { navForMember } from "@/lib/nav";
import { hiddenTeamIds, teamScopeFilter, userTeamIds } from "@/lib/teamAccess";
import { latestAnnouncements } from "@/lib/community/summary";
import { listActivity } from "@/lib/search/query";
export async function getDashboardData(
  workspace: Workspace,
  userId: string,
  membership: RoleHolder,
) {
  const now = new Date();
  const actor = { workspaceId: workspace.id, userId, role: membership!.role };
  const [hidden, teams, enabledModules] = await Promise.all([
    hiddenTeamIds(workspace.id, actor),
    userTeamIds(workspace.id, userId),
    getWorkspaceModules(workspace.id),
  ]);
  // Widgets follow the sidebar: a card shows only when its area's nav item is visible (role + module).
  const nav = new Set(navForMember(workspace.slug, { role: actor.role, workspace, enabledModules }).flatMap((group) => group.items.map((item) => item.key)));
  const show = {
    myTasks: canContribute(membership) && nav.has("my-tasks"),
    meetings: nav.has("meetings"),
    shifts: nav.has("rota"),
    announcements: nav.has("announcements"),
    activity: nav.has("activity"),
    finance: nav.has("finance"),
    services: nav.has("services"),
    appReviews: nav.has("app-reviews"),
    projects: nav.has("projects"),
    links: nav.has("links"),
  };
  const project: Prisma.TaskWhereInput = {
    OR: [
      { projectId: null },
      {
        project: {
          workspaceId: workspace.id,
          ...teamScopeFilter(hidden),
          status: { not: "ARCHIVED" },
        },
      },
    ],
  };
  const mine: Prisma.TaskWhereInput = {
    workspaceId: workspace.id,
    completedAt: null,
    archivedAt: null,
    assignees: { some: { userId } },
    ...project,
  };
  const [
    myOpenTasks,
    myTasks,
    memberCount,
    announcements,
    activity,
    ledger,
    shifts,
    meetings,
    mentions,
    services,
    unrepliedLowRatings,
  ] = await Promise.all([
    show.myTasks ? prisma.task.count({ where: mine }) : 0,
    show.myTasks
      ? prisma.task.findMany({
          where: mine,
          orderBy: [
            { dueAt: { sort: "asc", nulls: "last" } },
            { updatedAt: "desc" },
          ],
          take: 6,
          select: {
            id: true,
            number: true,
            title: true,
            dueAt: true,
            project: { select: { key: true } },
          },
        })
      : [],
    prisma.membership.count({
      where: { workspaceId: workspace.id, status: "ACTIVE" },
    }),
    show.announcements ? latestAnnouncements(workspace.id, { take: 3, now }) : [],
    show.activity ? listActivity(actor) : [],
    show.finance
      ? prisma.ledgerEntry.groupBy({
          by: ["kind"],
          where: {
            workspaceId: workspace.id,
            voidedAt: null,
            currency: workspace.currency,
          },
          _sum: { amountMinor: true },
        })
      : null,
    show.shifts
      ? prisma.shift.findMany({
          where: {
            workspaceId: workspace.id,
            endsAt: { gte: now },
            shiftType: {
              workspaceId: workspace.id,
              ...teamScopeFilter(hidden),
            },
            assignments: {
              some: { userId, status: { in: ["CONFIRMED", "SWAP_REQUESTED"] } },
            },
          },
          orderBy: { startsAt: "asc" },
          take: 4,
          select: {
            id: true,
            startsAt: true,
            shiftType: { select: { name: true } },
          },
        })
      : [],
    show.meetings ? prisma.meeting.findMany({
      where: {
        workspaceId: workspace.id,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        startsAt: { gte: now },
        AND: [
          teamScopeFilter(hidden),
          {
            OR: [
              { visibility: "WORKSPACE" },
              { createdById: userId },
              { attendees: { some: { userId, rsvp: { not: "NO" } } } },
              { visibility: "TEAM", teamId: { in: teams } },
            ],
          },
        ],
      },
      orderBy: { startsAt: "asc" },
      take: 4,
      select: { id: true, title: true, startsAt: true },
    }) : [],
    prisma.notification.findMany({
      where: {
        workspaceId: workspace.id,
        userId,
        kind: "mention",
        archivedAt: null,
        readAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, title: true, url: true },
    }),
    show.services
      ? prisma.monitor.groupBy({
          by: ["lastStatus"],
          where: {
            workspaceId: workspace.id,
            OR: [
              { projectId: null },
              {
                project: {
                  workspaceId: workspace.id,
                  ...teamScopeFilter(hidden),
                },
              },
            ],
          },
          _count: true,
        })
      : [],
    show.appReviews ? prisma.appReview.count({ where: { workspaceId: workspace.id, rating: { lte: 2 }, replyStatus: { not: "SENT" } } }) : null,
  ]);
  const kittyMinor = ledger
    ? ledger.reduce(
        (total, row) =>
          total +
          (row.kind === "INCOME" ? 1 : -1) * (row._sum.amountMinor ?? 0),
        0,
      )
    : null;
  return {
    myOpenTasks,
    myTasks,
    memberCount,
    announcements,
    activity: activity.slice(0, 8),
    kittyMinor,
    shifts,
    meetings,
    mentions,
    services,
    unrepliedLowRatings,
    show,
    now,
  };
}

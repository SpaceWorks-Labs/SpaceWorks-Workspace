import "server-only";
import { prisma } from "@/lib/db";
import { serial } from "@/lib/meetings/core";
import { notifyMeeting } from "@/lib/calendar/service";
import { syncGoogle, resumeMeetLinks } from "@/lib/calendar/google";
import { dispatch } from "@/lib/notify";
export async function run(now: Date) {
  await resumeMeetLinks();
  const meetings = await prisma.meeting.findMany({
    where: {
      status: "SCHEDULED",
      reminderSentAt: null,
      startsAt: { gt: now, lte: new Date(now.getTime() + 7 * 86400000) },
      workspace: { status: "ACTIVE", archivedAt: null },
    },
    include: { workspace: true },
    take: 500,
    orderBy: { startsAt: "asc" },
  });
  for (const m of meetings) {
    if (m.startsAt.getTime() - now.getTime() > m.reminderMinutes * 60000)
      continue;
    const n = await serial(async (tx) => {
      const claimed = await tx.meeting.updateMany({
        where: {
          workspaceId: m.workspaceId,
          id: m.id,
          sequence: m.sequence,
          status: "SCHEDULED",
          reminderSentAt: null,
        },
        data: { reminderSentAt: now },
      });
      if (!claimed.count) return null;
      return notifyMeeting(
        tx,
        {
          workspace: m.workspace,
          user: { id: m.createdById ?? "", name: null },
          membership: { role: "MEMBER" },
        },
        m.id,
        "meeting.reminder",
      );
    });
    await n?.afterCommit();
  }
  const entries = await prisma.calendarEntry.findMany({
    where: {
      reminderSentAt: null,
      startsAt: { gt: now, lte: new Date(now.getTime() + 7 * 86400000) },
      workspace: { status: "ACTIVE", archivedAt: null },
    },
    include: { workspace: true },
    take: 500,
    orderBy: { startsAt: "asc" },
  });
  for (const e of entries) {
    if (e.startsAt.getTime() - now.getTime() > e.reminderMinutes * 60000)
      continue;
    const n = await serial(async (tx) => {
      const claim = await tx.calendarEntry.updateMany({
        where: {
          workspaceId: e.workspaceId,
          id: e.id,
          reminderSentAt: null,
          startsAt: e.startsAt,
        },
        data: { reminderSentAt: now },
      });
      if (!claim.count) return null;
      return dispatch(
        e.workspaceId,
        {
          type: "calendar.reminder",
          title: `Reminder: ${e.title}`.slice(0, 150),
          recipients: [e.ownerId],
          useWorkspaceRules: false,
          resource: { type: "calendar_entry", id: e.id },
          url: `/w/${e.workspace.slug}/calendar`,
          data: { entryId: e.id },
          dedupeKey: `entry:${e.id}:${e.startsAt.toISOString()}`,
        },
        { tx },
      );
    });
    await n?.afterCommit();
  }
  await syncConnectedCalendars(now);
}

export async function syncConnectedCalendars(now: Date) {
  const bindings = await prisma.calendarMeetingSync.findMany({
    where: {
      workspace: { status: "ACTIVE", archivedAt: null },
      OR: [
        { lastSyncedAt: null },
        { lastSyncedAt: { lt: new Date(now.getTime() - 5 * 60000) } },
      ],
    },
    select: { workspaceId: true, userId: true },
    distinct: ["workspaceId", "userId"],
    take: 10,
  });
  for (const binding of bindings) {
    const membership = await prisma.membership.findFirst({
      where: {
        workspaceId: binding.workspaceId,
        userId: binding.userId,
        status: "ACTIVE",
        role: { not: "GUEST" },
        user: { disabledAt: null },
        workspace: { status: "ACTIVE", archivedAt: null },
      },
      include: { user: true, workspace: true },
    });
    if (!membership) continue;
    try {
      await syncGoogle({
        user: membership.user,
        workspace: membership.workspace,
        membership,
      });
    } catch {
      /* The next scheduled pass retries; no provider bodies reach logs. */
    }
  }
}

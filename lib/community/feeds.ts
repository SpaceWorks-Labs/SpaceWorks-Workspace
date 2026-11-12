import "server-only";

import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { visibleTaskWhere } from "@/lib/tasks/access";
import { taskUrl } from "@/lib/tasks/links";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { meetingWhere } from "@/lib/meetings/service";
import { entryWhere } from "@/lib/calendar/access";
import { canContribute } from "@/lib/roles";
import { safeTimeZone } from "@/lib/timeZone";
import { canSubscribeToCalendar } from "@/lib/community/access";
import type { CommunityActor } from "@/lib/community/context";
import { buildCalendar, type IcsEntry } from "@/lib/community/ics";
import { dayKey, effectiveEnd } from "@/lib/community/schedule";
import { feedScopeSchema, type FeedScope } from "@/lib/community/validation";

/** Personal subscriptions contain only internal meetings, shifts and task due dates.
 * Tokens are stored as hashes and access is checked on every fetch. */

const DAY = 24 * 60 * 60 * 1000;
const PAST_WINDOW = 60 * DAY;
const FUTURE_WINDOW = 400 * DAY;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function baseUrl() {
  return (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
}

export function feedUrls(token: string, base = baseUrl()) {
  const https = `${base}/ics/${token}.ics`;
  return { url: https, webcalUrl: https.replace(/^https?:\/\//, "webcal://") };
}

export async function listFeeds(actor: CommunityActor) {
  const rows = await prisma.calendarFeedToken.findMany({
    where: { workspaceId: actor.workspace.id, userId: actor.user.id, revokedAt: null, scope: "PERSONAL" },
    orderBy: { createdAt: "desc" },
    select: { scope: true, createdAt: true },
  });
  return new Map(rows.map((row) => [row.scope as FeedScope, row.createdAt] as const));
}

/** Create (or regenerate) a feed URL. The raw token is returned once and never stored. */
export async function createFeed(actor: CommunityActor, input: unknown, now = new Date()): Promise<ActionResult<{ url: string; webcalUrl: string }>> {
  if (!canSubscribeToCalendar(actor.membership)) return actionError(NOT_ALLOWED);
  const parsed = feedScopeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const token = randomToken(32);
  await prisma.$transaction(async (tx) => {
    const revoked = await tx.calendarFeedToken.updateMany({
      where: { workspaceId: actor.workspace.id, userId: actor.user.id, scope: parsed.data.scope, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.calendarFeedToken.create({ data: { workspaceId: actor.workspace.id, userId: actor.user.id, scope: parsed.data.scope, tokenHash: sha256Hex(token) } });
    await recordAuditEvent({
      client: tx,
      action: revoked.count > 0 ? "calendar_feed.regenerated" : "calendar_feed.created",
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      targetType: "CalendarFeedToken",
      metadata: { scope: parsed.data.scope },
    });
  });
  return { ok: true, data: feedUrls(token) };
}

export async function revokeFeed(actor: CommunityActor, input: unknown, now = new Date()): Promise<ActionResult> {
  if (!canSubscribeToCalendar(actor.membership)) return actionError(NOT_ALLOWED);
  const parsed = feedScopeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const revoked = await prisma.calendarFeedToken.updateMany({
    where: { workspaceId: actor.workspace.id, userId: actor.user.id, scope: parsed.data.scope, revokedAt: null },
    data: { revokedAt: now },
  });
  if (revoked.count > 0) {
    await recordAuditEvent({ action: "calendar_feed.revoked", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "CalendarFeedToken", metadata: { scope: parsed.data.scope } });
  }
  return { ok: true };
}

/** The member and workspace a raw feed token stands for, or null (unknown, revoked, or access ended). */
export async function resolveFeedToken(raw: string) {
  if (!TOKEN_PATTERN.test(raw)) return null;
  const token = await prisma.calendarFeedToken.findUnique({
    where: { tokenHash: sha256Hex(raw) },
    select: { scope: true, revokedAt: true, userId: true, workspace: { select: { id: true, slug: true, name: true, timezone: true, archivedAt: true, status: true } } },
  });
  if (!token || token.revokedAt || !token.userId || token.workspace.archivedAt || token.workspace.status !== "ACTIVE") return null;
  if (token.scope !== "PERSONAL") return null;
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: token.userId, workspaceId: token.workspace.id } },
    select: { status: true, role: true, user: { select: { disabledAt: true } } },
  });
  if (!membership || membership.status !== "ACTIVE" || membership.user.disabledAt) return null;
  return { scope: token.scope as FeedScope, userId: token.userId, role: membership.role, workspace: token.workspace };
}

/** Build the feed body for a resolved token. */
export async function buildFeed(feed: NonNullable<Awaited<ReturnType<typeof resolveFeedToken>>>, now = new Date()): Promise<string> {
  const zone = safeTimeZone(feed.workspace.timezone);
  const window = { gte: new Date(now.getTime() - PAST_WINDOW), lte: new Date(now.getTime() + FUTURE_WINDOW) };
  const base = baseUrl();
  const entries: IcsEntry[] = [];

  const actor = { user: { id: feed.userId, name: null }, workspace: feed.workspace, membership: { role: feed.role } };
  const hidden = await hiddenTeamIds(feed.workspace.id, { userId: feed.userId, role: feed.role });
  {
    const [meetings, shifts, tasks] = await Promise.all([
      prisma.meetingAttendee.findMany({
        where: { userId: feed.userId, rsvp: { not: "NO" }, meeting: { ...(await meetingWhere(actor)), startsAt: window } },
        take: 500,
        select: { rsvp: true, meeting: { select: { id: true, title: true, startsAt: true, endsAt: true, location: true, status: true, updatedAt: true, sequence: true } } },
      }),
      canContribute(actor.membership) ? prisma.shiftAssignment.findMany({
        where: { userId: feed.userId, status: { in: ["CONFIRMED", "WAITLIST", "SWAP_REQUESTED"] }, shift: { workspaceId: feed.workspace.id, startsAt: window, shiftType: { workspaceId: feed.workspace.id, ...teamScopeFilter(hidden) } } },
        take: 500,
        select: { status: true, shift: { select: { id: true, startsAt: true, endsAt: true, location: true, notes: true, shiftType: { select: { name: true } } } } },
      }) : [],
      canContribute(actor.membership) ? prisma.task.findMany({
        // Current task visibility (private teams, archived projects) for the feed owner.
        where: { AND: [await visibleTaskWhere({ user: { id: feed.userId, name: null }, workspace: feed.workspace, membership: { role: feed.role } }), { workspaceId: feed.workspace.id, archivedAt: null, completedAt: null, dueAt: window, assignees: { some: { userId: feed.userId } }, OR: [{ projectId: null }, { project: { workspaceId: feed.workspace.id, status: { not: "ARCHIVED" }, ...teamScopeFilter(hidden) } }] }] },
        take: 500,
        select: { id: true, number: true, title: true, dueAt: true, updatedAt: true, project: { select: { key: true } } },
      }) : [],
    ]);
    for (const { meeting, rsvp } of meetings) {
      const url = `${base}/w/${feed.workspace.slug}/meetings/${meeting.id}`;
      entries.push({
        uid: `meeting-${meeting.id}@spaceworks-workspace`,
        sequence: meeting.sequence,
        summary: `${meeting.status === "CANCELLED" ? "Cancelled: " : ""}${meeting.title}`,
        description: `Meeting · ${url}`,
        location: meeting.location,
        url,
        status: meeting.status === "CANCELLED" ? "CANCELLED" : rsvp === "YES" ? "CONFIRMED" : "TENTATIVE",
        lastModified: meeting.updatedAt,
        start: meeting.startsAt,
        end: effectiveEnd(meeting.startsAt, meeting.endsAt),
      });
    }
    for (const { shift, status } of shifts) {
      const url = `${base}/w/${feed.workspace.slug}/rota`;
      entries.push({
        uid: `shift-${shift.id}@spaceworks-workspace`,
        summary: `${shift.shiftType.name} shift${status === "WAITLIST" ? " (waitlist)" : ""}`,
        description: [shift.notes, `Rota · ${url}`].filter(Boolean).join("\n\n"),
        location: shift.location,
        url,
        status: status === "CONFIRMED" ? "CONFIRMED" : "TENTATIVE",
        start: shift.startsAt,
        end: effectiveEnd(shift.startsAt, shift.endsAt),
      });
    }
    for (const task of tasks) {
      const ref = task.project ? `${task.project.key}-${task.number}` : `#${task.number}`;
      const url = `${base}${taskUrl(feed.workspace.slug, task.project?.key, task.number)}`;
      entries.push({
        uid: `task-due-${task.id}@spaceworks-workspace`,
        summary: `Due: ${ref} ${task.title}`,
        description: `Task due · ${url}`,
        url,
        lastModified: task.updatedAt,
        allDay: dayKey(task.dueAt!, zone),
      });
    }
  }

  const [renewals, dates] = await Promise.all([
    canContribute(actor.membership) ? prisma.subscription.findMany({ where: { workspaceId: feed.workspace.id, status: "ACTIVE", nextRenewalAt: window, ...teamScopeFilter(hidden) }, select: { id: true, name: true, nextRenewalAt: true, updatedAt: true }, take: 500 }) : [],
    prisma.calendarEntry.findMany({ where: { AND: [await entryWhere(actor), { startsAt: window }] }, take: 500 }),
  ]);
  for (const renewal of renewals) entries.push({ uid: `renewal-${renewal.id}@spaceworks-workspace`, summary: `Renewal: ${renewal.name}`, allDay: dayKey(renewal.nextRenewalAt!, zone), lastModified: renewal.updatedAt, url: `${base}/w/${feed.workspace.slug}/subscriptions` });
  for (const date of dates) entries.push({ uid: `calendar-${date.id}@spaceworks-workspace`, summary: date.title, start: date.startsAt, end: date.endsAt, lastModified: date.updatedAt, url: `${base}/w/${feed.workspace.slug}/calendar` });

  return buildCalendar({
    name: `${feed.workspace.name} · my calendar`,
    description: "Your meetings, shifts, task due dates, renewals and reminders.",
    timeZone: zone,
    entries,
    now,
  });
}

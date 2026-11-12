import "server-only";

import type { Prisma } from "@prisma/client";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getScopedDestinationIds, listPickableDestinations, setScopedDestinations } from "@/lib/notify/scopedRules";
import { dispatch } from "@/lib/notify/dispatch";
import { publish } from "@/lib/realtime";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { zonedInputToIso } from "@/lib/timeZone";
import { canManageAnnouncements } from "@/lib/community/access";
import { activeMemberIds, displayName, tryTransactionLock, workspaceZone, type CommunityActor } from "@/lib/community/context";
import { excerpt, richTextToPlain, sanitizeRichText } from "@/lib/community/richText";
import { ANNOUNCEMENT_CATCH_UP_MS, announcementDedupeKey, announcementStatus } from "@/lib/community/schedule";
import { announcementInputSchema } from "@/lib/community/validation";

/**
 * Announcements: admins write rich-text notices, pin them, publish now,
 * schedule them or keep drafts. Members and guests only ever see published
 * ones. Publishing dispatches `announcement.published` exactly once per
 * publish time, to every member in-app, to workspace rules and to the
 * announcement's own "Send to" destinations (scope `announcementId`).
 */

const SCOPE_TYPE = "ANNOUNCEMENT" as const;
const EVENT_TYPE = "announcement.published" as const;

const announcementUrl = (slug: string, id: string) => `/w/${slug}/announcements/${id}`;

type WorkspaceRef = { id: string; slug: string; name: string };
type AnnouncementRow = { id: string; title: string; body: string; publishedAt: Date | null; authorId: string | null };

/** Visible announcements: pinned first, then newest. Admins also see drafts and scheduled ones. */
export async function listAnnouncements(actor: CommunityActor, options: { now?: Date; take?: number } = {}) {
  const now = options.now ?? new Date();
  const manage = canManageAnnouncements(actor.membership);
  const rows = await prisma.announcement.findMany({
    where: { workspaceId: actor.workspace.id, ...(manage ? {} : { publishedAt: { not: null, lte: now } }) },
    orderBy: [{ pinned: "desc" }, { publishedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: Math.min(options.take ?? 50, 200),
    select: { id: true, title: true, body: true, pinned: true, publishedAt: true, createdAt: true, updatedAt: true, author: { select: { id: true, name: true, image: true } } },
  });
  return rows.map((row) => ({ ...row, status: announcementStatus(row.publishedAt, now), preview: excerpt(richTextToPlain(row.body)) }));
}

/** One announcement, or null when it does not exist here or the actor may not see it yet. */
export async function getAnnouncement(actor: CommunityActor, id: string, now = new Date()) {
  const row = await prisma.announcement.findFirst({
    where: { id, workspaceId: actor.workspace.id },
    select: { id: true, title: true, body: true, pinned: true, publishedAt: true, createdAt: true, updatedAt: true, author: { select: { id: true, name: true, image: true } } },
  });
  if (!row) return null;
  const status = announcementStatus(row.publishedAt, now);
  if (status !== "published" && !canManageAnnouncements(actor.membership)) return null;
  return { ...row, status, body: sanitizeRichText(row.body) };
}

/** Destinations for the "Send to" picker plus the announcement's current choice. */
export async function announcementDestinations(actor: CommunityActor, announcementId: string | null) {
  const [options, selected] = await Promise.all([
    listPickableDestinations(actor.workspace.id, actor.membership.role),
    announcementId ? getScopedDestinationIds(actor.workspace.id, SCOPE_TYPE, announcementId) : Promise.resolve([] as string[]),
  ]);
  return { options, selected };
}

/**
 * Dispatch `announcement.published` once for this publish time. Safe to call
 * from the save action and from every scheduler replica: an advisory lock
 * serialises callers and the stored event record makes repeats no-ops.
 */
export async function publishAnnouncementEvent(tx: Prisma.TransactionClient, workspace: WorkspaceRef, announcement: AnnouncementRow, now: Date) {
  if (!announcement.publishedAt || announcement.publishedAt.getTime() > now.getTime()) return null;
  const key = announcementDedupeKey(announcement.id, announcement.publishedAt);
  if (!(await tryTransactionLock(tx, key))) return null;
  const sent = await tx.notificationEventRecord.findFirst({ where: { workspaceId: workspace.id, type: EVENT_TYPE, dedupeKey: key }, select: { id: true } });
  if (sent) return null;
  const author = announcement.authorId ? await tx.user.findUnique({ where: { id: announcement.authorId }, select: { name: true } }) : null;
  const plain = richTextToPlain(announcement.body);
  const result = await dispatch(
    workspace.id,
    {
      type: EVENT_TYPE,
      title: `Announcement: ${announcement.title}`.slice(0, 150),
      body: excerpt(plain, 600),
      url: announcementUrl(workspace.slug, announcement.id),
      actorId: announcement.authorId,
      recipients: await activeMemberIds(tx, workspace.id),
      resource: { type: "announcement", id: announcement.id },
      scope: { announcementId: announcement.id },
      dedupeKey: key,
      fields: author ? [{ label: "From", value: displayName(author.name) }] : undefined,
      data: { announcementId: announcement.id },
    },
    { tx, now },
  );
  await indexSearchDocument(
    { workspaceId: workspace.id, entityType: "announcement", entityId: announcement.id, title: announcement.title, body: plain, url: announcementUrl(workspace.slug, announcement.id), ownerId: announcement.authorId },
    tx,
  );
  await recordActivity(
    { workspaceId: workspace.id, actorId: announcement.authorId, verb: "published", entityType: "announcement", entityId: announcement.id, summary: `Announcement: ${announcement.title}` },
    tx,
  );
  return result;
}

async function afterPublish(workspaceId: string, announcementId: string, result: Awaited<ReturnType<typeof publishAnnouncementEvent>>) {
  await result?.afterCommit();
  await publish(workspaceId, "workspace", { type: "community.announcement.changed", data: { announcementId } });
}

export async function saveAnnouncement(actor: CommunityActor, input: unknown, existingId: string | null, now = new Date()): Promise<ActionResult<{ id: string }>> {
  if (!canManageAnnouncements(actor.membership)) return actionError(NOT_ALLOWED);
  const parsed = announcementInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = parsed.data;

  const body = sanitizeRichText(data.body);
  if (!richTextToPlain(body)) return actionError("Write something for the crew to read.", { body: ["Write something for the crew to read."] });

  const existing = existingId
    ? await prisma.announcement.findFirst({ where: { id: existingId, workspaceId: actor.workspace.id }, select: { id: true, publishedAt: true } })
    : null;
  if (existingId && !existing) return actionError("That announcement no longer exists.");

  let publishedAt: Date | null;
  if (existing?.publishedAt && existing.publishedAt.getTime() <= now.getTime()) {
    publishedAt = existing.publishedAt; // already out: edits never re-send it
  } else if (data.publish === "now") {
    publishedAt = now;
  } else if (data.publish === "schedule") {
    const iso = zonedInputToIso(data.scheduledFor ?? "", workspaceZone(actor));
    if (!iso) return actionError("That time doesn't exist in the workspace time zone. Pick another.", { scheduledFor: ["Pick another time."] });
    publishedAt = new Date(iso);
    if (publishedAt.getTime() <= now.getTime() + 60_000) {
      return actionError("Pick a time at least a minute from now, or publish it now.", { scheduledFor: ["Pick a later time."] });
    }
  } else {
    publishedAt = null;
  }

  // Keep destinations this admin cannot pick right now (e.g. temporarily disabled ones).
  const pickable = new Set((await listPickableDestinations(actor.workspace.id, actor.membership.role)).map((row) => row.id));
  const current = existing ? await getScopedDestinationIds(actor.workspace.id, SCOPE_TYPE, existing.id) : [];
  const destinationIds = [...new Set([...data.destinationIds.filter((id) => pickable.has(id)), ...current.filter((id) => !pickable.has(id))])];

  const { announcement, result } = await prisma.$transaction(async (tx) => {
    const fields = { title: data.title, body, pinned: data.pinned, publishedAt };
    const announcement = existing
      ? await tx.announcement.update({ where: { id: existing.id }, data: fields })
      : await tx.announcement.create({ data: { ...fields, workspaceId: actor.workspace.id, authorId: actor.user.id } });
    await setScopedDestinations(tx, {
      workspaceId: actor.workspace.id,
      scopeType: SCOPE_TYPE,
      scopeId: announcement.id,
      destinationIds,
      actorId: actor.user.id,
      eventTypes: [EVENT_TYPE],
      name: `Announcement: ${data.title}`.slice(0, 120),
    });
    const status = announcementStatus(publishedAt, now);
    if (status === "published") {
      // Re-index edits of an announcement that is already out.
      if (existing?.publishedAt && existing.publishedAt.getTime() <= now.getTime()) {
        await indexSearchDocument(
          { workspaceId: actor.workspace.id, entityType: "announcement", entityId: announcement.id, title: announcement.title, body: richTextToPlain(body), url: announcementUrl(actor.workspace.slug, announcement.id), ownerId: announcement.authorId },
          tx,
        );
      }
    } else {
      await removeSearchDocument("announcement", announcement.id, tx);
    }
    const result = await publishAnnouncementEvent(tx, actor.workspace, announcement, now);
    await recordAuditEvent({
      client: tx,
      action: existing ? "announcement.updated" : "announcement.created",
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      targetType: "Announcement",
      targetId: announcement.id,
      metadata: { status, pinned: data.pinned, destinations: destinationIds.length },
    });
    return { announcement, result };
  }, { timeout: 15_000 });
  await afterPublish(actor.workspace.id, announcement.id, result);
  return { ok: true, data: { id: announcement.id } };
}

export async function setAnnouncementPinned(actor: CommunityActor, id: string, pinned: boolean): Promise<ActionResult> {
  if (!canManageAnnouncements(actor.membership)) return actionError(NOT_ALLOWED);
  const updated = await prisma.announcement.updateMany({ where: { id, workspaceId: actor.workspace.id }, data: { pinned } });
  if (updated.count === 0) return actionError("That announcement no longer exists.");
  await recordAuditEvent({ action: pinned ? "announcement.pinned" : "announcement.unpinned", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Announcement", targetId: id });
  await publish(actor.workspace.id, "workspace", { type: "community.announcement.changed", data: { announcementId: id } });
  return { ok: true };
}

export async function deleteAnnouncement(actor: CommunityActor, id: string): Promise<ActionResult> {
  if (!canManageAnnouncements(actor.membership)) return actionError(NOT_ALLOWED);
  const deleted = await prisma.$transaction(async (tx) => {
    const row = await tx.announcement.findFirst({ where: { id, workspaceId: actor.workspace.id }, select: { id: true, title: true } });
    if (!row) return null;
    await tx.announcement.delete({ where: { id: row.id } });
    await setScopedDestinations(tx, { workspaceId: actor.workspace.id, scopeType: SCOPE_TYPE, scopeId: row.id, destinationIds: [], actorId: actor.user.id });
    await removeSearchDocument("announcement", row.id, tx);
    await recordAuditEvent({ client: tx, action: "announcement.deleted", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Announcement", targetId: row.id });
    return row;
  });
  if (!deleted) return actionError("That announcement no longer exists.");
  await publish(actor.workspace.id, "workspace", { type: "community.announcement.changed", data: { announcementId: id } });
  return { ok: true };
}

/** Scheduler: send announcements whose publish time has come (idempotent across replicas). */
export async function publishDueAnnouncements(now: Date) {
  const due = await prisma.announcement.findMany({
    where: { publishedAt: { gt: new Date(now.getTime() - ANNOUNCEMENT_CATCH_UP_MS), lte: now }, workspace: { status: "ACTIVE", archivedAt: null } },
    orderBy: { publishedAt: "asc" },
    take: 100,
    select: { id: true, title: true, body: true, publishedAt: true, authorId: true, workspace: { select: { id: true, slug: true, name: true } } },
  });
  if (due.length === 0) return 0;
  const keys = due.map((row) => announcementDedupeKey(row.id, row.publishedAt!));
  const sent = new Set(
    (await prisma.notificationEventRecord.findMany({ where: { type: EVENT_TYPE, dedupeKey: { in: keys } }, select: { dedupeKey: true } })).map((row) => row.dedupeKey),
  );
  let published = 0;
  for (const row of due) {
    if (sent.has(announcementDedupeKey(row.id, row.publishedAt!))) continue;
    const result = await prisma.$transaction((tx) => publishAnnouncementEvent(tx, row.workspace, row, now), { timeout: 15_000 });
    if (result) {
      published += 1;
      await afterPublish(row.workspace.id, row.id, result);
    }
  }
  return published;
}

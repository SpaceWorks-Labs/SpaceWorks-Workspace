import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { client, SocialApiError } from "../http";
import { socialToken } from "../tokens";
import { cleanMetrics, object, snapshot, type Snapshot, type SyncInput } from "../types";
import { youtubeSync } from "../providers/youtube";
import { metaSync } from "../providers/meta";
import { linkedinSync } from "../providers/linkedin";
import { xSync } from "../providers/x";
export async function claimAccount(workspaceId: string, accountId: string, now = new Date(), manual = false) {
  const leaseToken = randomUUID();
  const claimed = await prisma.socialAccount.updateMany({ where: { workspaceId, id: accountId, status: { in: ["ACTIVE", "DEGRADED"] }, workspace: { status: "ACTIVE", archivedAt: null }, nextSyncAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseToken, leaseUntil: new Date(now.getTime() + 600000), ...(manual ? { nextSyncAt: new Date(now.getTime() + 900000) } : {}) } });
  return claimed.count ? leaseToken : null;
}
export async function persistSnapshot(account: SocialAccount, batch: Snapshot, now: Date, leaseToken: string) {
  let newComments = 0;
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "SocialAccount" WHERE "workspaceId"=${account.workspaceId} AND id=${account.id} FOR UPDATE`;
    const active = await tx.socialAccount.findFirst({ where: { workspaceId: account.workspaceId, id: account.id, leaseToken, leaseUntil: { gt: new Date() }, status: { in: ["ACTIVE", "DEGRADED"] } } }); if (!active) throw new Error("The sync claim expired. The next sync will retry.");
    for (const metric of batch.metrics) { if (!Number.isFinite(metric.value)) continue; await tx.socialMetricDaily.upsert({ where: { workspaceId_accountId_date_metric: { workspaceId: account.workspaceId, accountId: account.id, date: metric.date, metric: metric.metric } }, create: { workspaceId: account.workspaceId, accountId: account.id, ...metric }, update: { value: metric.value } }); }
    for (const post of new Map(batch.posts.map(p => [p.externalId, p])).values()) {
      const metrics = cleanMetrics(post.metrics), { likes, comments, shares, views, impressions, reach } = metrics;
      const previous = await tx.socialPost.findFirst({ where: { workspaceId: account.workspaceId, accountId: account.id, externalId: post.externalId }, select: { latestMetrics: true } });
      const data = { text: post.text.slice(0, 2000), url: post.url, mediaType: post.mediaType, publishedAt: post.publishedAt, latestMetrics: { ...object(previous?.latestMetrics), ...metrics } as Prisma.InputJsonValue, likes, comments, shares, views, impressions, reach };
      await tx.socialPost.upsert({ where: { workspaceId_accountId_externalId: { workspaceId: account.workspaceId, accountId: account.id, externalId: post.externalId } }, create: { workspaceId: account.workspaceId, accountId: account.id, externalId: post.externalId, ...data }, update: data });
    }
    for (const comment of new Map(batch.comments.map(c => [c.externalId, c])).values()) {
      if (comment.ours || await tx.socialComment.findFirst({ where: { workspaceId: account.workspaceId, accountId: account.id, replyExternalId: comment.externalId }, select: { id: true } })) continue;
      let post = await tx.socialPost.findFirst({ where: { workspaceId: account.workspaceId, accountId: account.id, externalId: comment.postExternalId }, select: { id: true } });
      // A comment can arrive before its older post enters the bounded backfill.
      if (!post) post = await tx.socialPost.create({ data: { workspaceId: account.workspaceId, accountId: account.id, externalId: comment.postExternalId, text: "Post details unavailable.", mediaType: "POST", publishedAt: comment.publishedAt }, select: { id: true } });
      const key = { workspaceId: account.workspaceId, accountId: account.id, externalId: comment.externalId };
      const content = { text: comment.text.slice(0, 30000), authorName: comment.authorName.slice(0, 200), authorHandle: comment.authorHandle, authorAvatarUrl: comment.authorAvatarUrl, likeCount: Math.max(0, Math.min(2147483647, Math.round(comment.likeCount))), parentExternalId: comment.parentExternalId };
      const added = await tx.socialComment.createMany({ data: [{ ...key, ...content, postId: post.id, publishedAt: comment.publishedAt, status: comment.hidden ? "HIDDEN" : "NEW" }], skipDuplicates: true });
      await tx.socialComment.updateMany({ where: key, data: content });
      if (comment.hidden === true) await tx.socialComment.updateMany({ where: { ...key, status: { not: "DELETED" }, operationToken: null }, data: { status: "HIDDEN" } });
      if (comment.hidden === false) {
        await tx.socialComment.updateMany({ where: { ...key, status: "HIDDEN", operationToken: null, replyExternalId: null }, data: { status: "SEEN" } });
        await tx.socialComment.updateMany({ where: { ...key, status: "HIDDEN", operationToken: null, replyExternalId: { not: null } }, data: { status: "REPLIED" } });
      }
      if (added.count) { newComments++; const stored = await tx.socialComment.findFirstOrThrow({ where: key, select: { id: true } }); await dispatch(account.workspaceId, { type: "social.comment.received", title: `New comment on ${account.displayName}`, url: `/w/${(await tx.workspace.findUniqueOrThrow({ where: { id: account.workspaceId }, select: { slug: true } })).slug}/social/comments/${stored.id}`, dedupeKey: `social-comment:${stored.id}`, data: { accountId: account.id, commentId: stored.id } }, { tx }); }
    }
  }, { timeout: 60000 });
  return newComments;
}
export async function syncAccount(workspaceId: string, accountId: string, now = new Date(), manual = false) {
  const lease = await claimAccount(workspaceId, accountId, now, manual); if (!lease) return { synced: false, comments: 0 };
  const account = await prisma.socialAccount.findFirstOrThrow({ where: { workspaceId, id: accountId } });
  const log = await prisma.socialSyncLog.create({ data: { workspaceId, accountId, startedAt: now, status: "RUNNING" } });
  let batch = snapshot(), deferred: Date | undefined; let created = 0; let persisted = false;
  try {
    const token = await socialToken(account);
    const api = client(token, until => { if (!deferred || until > deferred) deferred = until; });
    const offset = Math.max(0, Number(object(account.cursor).commentPostOffset) || 0);
    const recentPosts = await prisma.socialPost.findMany({ where: { workspaceId, accountId }, select: { externalId: true, publishedAt: true }, orderBy: [{ publishedAt: "desc" }, { id: "asc" }], skip: offset, take: 10 });
    const input: SyncInput = { account, token, now, daily: !account.lastMetricsAt || now.getTime() - account.lastMetricsAt.getTime() >= 86400000, recentPosts };
    batch = await (account.platform === "YOUTUBE" ? youtubeSync : account.platform === "LINKEDIN" ? linkedinSync : account.platform === "X" ? xSync : metaSync)(input, api);
    batch.cursor.commentPostOffset = recentPosts.length === 10 ? String(offset + 10) : "0";
    created = await persistSnapshot(account, batch, now, lease); persisted = true;
  } catch (error) { batch.error = error instanceof Error ? error : new Error("The account could not sync. Try again later."); }
  const error = batch.error; const apiError = error instanceof SocialApiError ? error : undefined;
  const failures = error ? account.failures + 1 : deferred && deferred.getTime() > now.getTime() + 900000 ? 1 : 0; const delay = error ? Math.min(21600000, 900000 * 2 ** Math.min(failures - 1, 5)) : 900000;
  const nextSyncAt = new Date(Math.max(now.getTime() + delay, deferred?.getTime() ?? 0, apiError?.retryAt?.getTime() ?? 0));
  const message = error ? apiError ? apiError.message : "Some data could not be synced. Review the account permissions and try again." : null;
  await prisma.$transaction(async tx => {
    const done = await tx.socialAccount.updateMany({ where: { workspaceId, id: accountId, leaseToken: lease }, data: { leaseUntil: null, leaseToken: null, nextSyncAt, failures, status: apiError?.kind === "TOKEN" ? "RECONNECT" : error || batch.warnings.length ? "DEGRADED" : "ACTIVE", lastError: message, warnings: [...new Set(batch.warnings)].slice(0, 15), ...(!error ? { lastSyncedAt: now } : {}), ...(persisted && batch.metricsComplete ? { lastMetricsAt: now } : {}), ...(persisted ? { cursor: { ...object(account.cursor), ...batch.cursor } as Prisma.InputJsonValue } : {}) } });
    await tx.socialSyncLog.updateMany({ where: { workspaceId, id: log.id }, data: { status: done.count ? error ? "PARTIAL" : "SUCCESS" : "CANCELLED", finishedAt: new Date(), posts: batch.posts.length, comments: created, error: message } });
    if (done.count && account.expiresAt && account.expiresAt.getTime() < now.getTime() + 7 * 86400000 && !account.refreshTokenEnc) await dispatch(workspaceId, { type: "social.token.expiring", title: `Reconnect ${account.displayName} soon`, dedupeKey: `social-expiring:${accountId}:${now.toISOString().slice(0, 10)}`, data: { accountId }, url: `/w/${(await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true } })).slug}/settings/social` }, { tx });
  });
  return { synced: true, comments: created, error: message };
}

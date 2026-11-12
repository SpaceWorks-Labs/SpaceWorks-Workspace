import "server-only";
import { randomUUID } from "node:crypto";
import type { ReviewedApp } from "@prisma/client";
import { prisma } from "@/lib/db";
import { indexSearchDocument } from "@/lib/search/documents";
import { recordActivity } from "@/lib/activity";
import { storeFor } from "./stores";
import { StoreError, safeStoreError, type StoreReview } from "./stores/types";
import { reviewEvent, reviewUrl } from "./events";

/** Create + dispatch commit together. A conflicting INSERT cannot emit another event. */
export async function ingestReview(app: ReviewedApp, slug: string, remote: StoreReview) {
  const result = await prisma.$transaction(async tx => {
    const key = { workspaceId: app.workspaceId, appId: app.id, externalReviewId: remote.externalReviewId };
    const { reply, ...content } = remote;
    const created = await tx.appReview.createMany({ data: [{ ...key, ...content, platform: app.platform, ...(reply ? { replyBody: reply.body, replyStatus: "SENT", replyExternalId: reply.externalId, replyPublishState: reply.state, replySentAt: reply.sentAt } : {}) }], skipDuplicates: true });
    let review = await tx.appReview.findUniqueOrThrow({ where: { workspaceId_appId_externalReviewId: key } });
    if (!created.count && remote.storeUpdatedAt >= review.storeUpdatedAt) {
      const { storeCreatedAt: _created, ...changed } = content; void _created;
      review = await tx.appReview.update({ where: { id: review.id, workspaceId: app.workspaceId }, data: { ...changed, ...(reply && review.replyStatus !== "SENDING" && !review.repliedById ? { replyBody: reply.body, replyStatus: "SENT", replyExternalId: reply.externalId, replyPublishState: reply.state, replySentAt: reply.sentAt } : {}) } });
    }
    await indexSearchDocument({ workspaceId: app.workspaceId, entityType: "app_review", entityId: review.id, title: `${app.name}: ${review.title || `${review.rating} out of 5`}`, body: `${review.author}\n${review.body}`, url: reviewUrl(slug, review.id), visibility: "WORKSPACE" }, tx);
    if (!created.count) return { id: review.id, created: false, notification: null };
    await recordActivity({ workspaceId: app.workspaceId, verb: "received", entityType: "app_review", entityId: review.id, summary: `New review for ${app.name}`, visibility: "WORKSPACE" }, tx);
    return { id: review.id, created: true, notification: await reviewEvent(review, app, slug, "app_review.received", `app-review:${review.id}:received`, tx) };
  });
  await result.notification?.afterCommit(); return { id: result.id, created: result.created };
}
/** Atomic DB lease works across replicas without relying on process-local locks. */
export async function pollApp(workspaceId: string, appId: string, now = new Date()) {
  const token = randomUUID();
  const app = await prisma.reviewedApp.findFirst({ where: { workspaceId, id: appId, active: true, account: { active: true }, workspace: { status: "ACTIVE", archivedAt: null } }, include: { account: true, workspace: { select: { slug: true } } } });
  if (!app) return { polled: false, created: 0 };
  const claim = await prisma.reviewedApp.updateMany({ where: { workspaceId, id: appId, active: true, nextPollAt: { lte: now }, OR: [{ pollLeaseUntil: null }, { pollLeaseUntil: { lte: now } }] }, data: { pollLeaseToken: token, pollLeaseUntil: new Date(now.getTime() + 300_000), nextPollAt: new Date(now.getTime() + app.pollIntervalMinutes * 60_000) } });
  if (!claim.count) return { polled: false, created: 0 };
  let created = 0;
  try {
    const client = storeFor(app, app.account);
    const heartbeat = async () => {
      const renewed = await prisma.reviewedApp.updateMany({ where: { workspaceId, id: appId, pollLeaseToken: token, active: true, account: { active: true }, workspace: { status: "ACTIVE", archivedAt: null } }, data: { pollLeaseUntil: new Date(Date.now() + 300_000) } });
      if (!renewed.count) throw new StoreError("STORE", "Polling stopped because this app was paused or another worker took over.");
    };
    // Only a completed earlier sync supplies a stopping boundary. Rows from a
    // partial failed sync must not hide older pages on the next attempt.
    const lastSuccessfulPoll = app.lastPolledAt;
    for await (const remote of client.reviews(async r => lastSuccessfulPoll ? Boolean(await prisma.appReview.findFirst({ where: { workspaceId, appId, externalReviewId: r.externalReviewId, createdAt: { lte: lastSuccessfulPoll } }, select: { id: true } })) : false, heartbeat)) {
      await heartbeat();
      if ((await ingestReview(app, app.workspace.slug, remote)).created) created++;
    }
    await prisma.reviewedApp.updateMany({ where: { workspaceId, id: appId, pollLeaseToken: token }, data: { lastPolledAt: new Date(), lastError: null } });
  } catch (error) {
    await prisma.reviewedApp.updateMany({ where: { workspaceId, id: appId, pollLeaseToken: token }, data: { lastError: safeStoreError(error) } });
  } finally {
    await prisma.reviewedApp.updateMany({ where: { workspaceId, id: appId, pollLeaseToken: token }, data: { pollLeaseUntil: null, pollLeaseToken: null } });
  }
  return { polled: true, created };
}

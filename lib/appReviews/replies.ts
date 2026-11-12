import "server-only";
import type { AppReviewReplySource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { storeFor } from "./stores";
import { safeStoreError, type StoreReply } from "./stores/types";
import { validateReply } from "./validation";
import { reviewEvent } from "./events";

export type ReplyInput = { workspaceId: string; reviewId: string; actorId: string; source: AppReviewReplySource; triggerKey: string; body: string };
export type ReplyOutcome = { state: "PUBLISHED" | "PENDING" | "UNKNOWN"; duplicate: boolean };
/** A permanent attempt claim precedes the network request. Never retry ambiguous sends. */
export async function sendReviewReply(input: ReplyInput): Promise<ActionResult<ReplyOutcome>> {
  const claim = await prisma.$transaction(async tx => {
    const member = await tx.membership.findFirst({ where: { workspaceId: input.workspaceId, userId: input.actorId, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null }, workspace: { status: "ACTIVE", archivedAt: null } }, select: { userId: true } });
    if (!member) return { error: "You don't have access to reply to this review." };
    await tx.$queryRaw`SELECT id FROM "AppReview" WHERE "workspaceId" = ${input.workspaceId} AND id = ${input.reviewId} FOR UPDATE`;
    const review = await tx.appReview.findFirst({ where: { workspaceId: input.workspaceId, id: input.reviewId }, include: { app: { include: { account: true } }, workspace: { select: { slug: true } } } });
    if (!review) return { error: "That review isn't available." };
    const invalid = validateReply(review.platform, input.body); if (invalid) return { error: invalid };
    const old = await tx.appReviewReplyAttempt.findUnique({ where: { workspaceId_triggerKey: { workspaceId: input.workspaceId, triggerKey: input.triggerKey } } });
    if (old) {
      if (old.reviewId !== review.id || old.actorId !== input.actorId || old.body !== input.body.trim()) return { error: "That send request has already been used. Reload before sending a different reply." };
      return { duplicate: true as const, review, attempt: old };
    }
    if (review.replyStatus === "SENDING") return { error: "A reply is already being sent. Check its state before trying again." };
    if (!review.app.active || !review.app.account.active) return { error: "This app is paused. Ask an admin to enable it." };
    const attempt = await tx.appReviewReplyAttempt.create({ data: { workspaceId: input.workspaceId, reviewId: review.id, actorId: input.actorId, source: input.source, triggerKey: input.triggerKey, body: input.body.trim() } });
    await tx.appReview.update({ where: { id: review.id, workspaceId: input.workspaceId }, data: { replyStatus: "SENDING", replyCheckedAt: null } });
    await recordAuditEvent({ action: "app_review.reply_requested", workspaceId: input.workspaceId, actorId: input.actorId, targetType: "AppReview", targetId: review.id, metadata: { source: input.source, attemptId: attempt.id }, client: tx });
    return { duplicate: false as const, review, attempt };
  });
  if (claim.error || !claim.review || !claim.attempt) return actionError(claim.error ?? "Couldn't prepare this reply. Try again.");
  if (claim.duplicate) {
    if (claim.attempt.status === "FAILED") return actionError(claim.attempt.error ?? "This reply couldn't be sent. Check the store before trying again.");
    return { ok: true, data: { state: claim.attempt.status === "SENDING" ? "UNKNOWN" : claim.review.replyPublishState, duplicate: true } };
  }
  const { review, attempt } = claim;
  let response: StoreReply;
  try { response = await storeFor(review.app, review.app.account).reply(review.externalReviewId, attempt.body, review.replyExternalId); }
  catch (error) {
    const message = safeStoreError(error);
    const event = await prisma.$transaction(async tx => {
      await tx.appReviewReplyAttempt.update({ where: { id: attempt.id, workspaceId: input.workspaceId }, data: { status: "FAILED", error: message, finishedAt: new Date() } });
      const failed = await tx.appReview.update({ where: { id: review.id, workspaceId: input.workspaceId }, data: { replyStatus: "FAILED", replyPublishState: "UNKNOWN", replyCheckedAt: new Date() } });
      return reviewEvent(failed, review.app, review.workspace.slug, "app_review.reply_failed", `app-review:${attempt.id}:failed`, tx);
    }); await event.afterCommit(); return actionError(`${message} Check the store before sending again.`);
  }
  // A database failure here leaves SENDING, intentionally: the reconciliation job reads
  // the remote response and never sends a second POST.
  const event = await prisma.$transaction(async tx => {
    await tx.appReviewReplyAttempt.update({ where: { id: attempt.id, workspaceId: input.workspaceId }, data: { status: "SENT", finishedAt: new Date() } });
    const updated = await tx.appReview.update({ where: { id: review.id, workspaceId: input.workspaceId }, data: { replyBody: response.body, replyStatus: "SENT", replyExternalId: response.externalId, replyPublishState: response.state, replySentAt: response.sentAt ?? new Date(), replyCheckedAt: new Date(), repliedById: input.actorId } });
    await recordActivity({ workspaceId: input.workspaceId, actorId: input.actorId, verb: "replied", entityType: "app_review", entityId: review.id, summary: `Replied to a review for ${review.app.name}`, visibility: "PRIVATE" }, tx);
    await recordAuditEvent({ action: "app_review.reply_sent", workspaceId: input.workspaceId, actorId: input.actorId, targetType: "AppReview", targetId: review.id, metadata: { attemptId: attempt.id, state: response.state }, client: tx });
    return response.state === "PUBLISHED" ? reviewEvent(updated, review.app, review.workspace.slug, "app_review.replied", `app-review:${attempt.id}:published`, tx) : null;
  });
  await event?.afterCommit(); return { ok: true, data: { state: response.state, duplicate: false } };
}
/** Read-only reconciliation of pending Apple replies and interrupted sends on both stores. */
export async function recheckReply(workspaceId: string, reviewId: string, now = new Date()) {
  const claimed = await prisma.appReview.updateMany({ where: { workspaceId, id: reviewId, OR: [{ replyCheckedAt: null }, { replyCheckedAt: { lte: new Date(now.getTime() - 300_000) } }] }, data: { replyCheckedAt: now } });
  if (!claimed.count) return;
  const review = await prisma.appReview.findFirst({ where: { workspaceId, id: reviewId, replyStatus: { in: ["SENT", "SENDING", "FAILED"] }, app: { active: true, account: { active: true } } }, include: { app: { include: { account: true } }, workspace: { select: { slug: true } } } });
  if (!review) return;
  const attempt = await prisma.appReviewReplyAttempt.findFirst({ where: { workspaceId, reviewId }, orderBy: { createdAt: "desc" } });
  if ((!attempt && !review.replyBody) || (attempt?.status === "SENDING" && attempt.createdAt.getTime() > now.getTime() - 300_000)) return;
  try {
    const remote = await storeFor(review.app, review.app.account).response(review.externalReviewId);
    if (!remote || (attempt && remote.body.trim() !== attempt.body.trim())) return;
    const event = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "AppReview" WHERE "workspaceId" = ${workspaceId} AND id = ${reviewId} FOR UPDATE`;
      const latest = await tx.appReviewReplyAttempt.findFirst({ where: { workspaceId, reviewId }, orderBy: { createdAt: "desc" } });
      const current = await tx.appReview.findFirst({ where: { workspaceId, id: reviewId } });
      if (!current || latest?.id !== attempt?.id || (current.replyStatus === "SENT" && current.replyPublishState === "PUBLISHED")) return null;
      if (attempt) await tx.appReviewReplyAttempt.update({ where: { id: attempt.id, workspaceId }, data: { status: "SENT", error: null, finishedAt: now } });
      const updated = await tx.appReview.update({ where: { id: reviewId, workspaceId }, data: { replyStatus: "SENT", replyBody: remote.body, replyExternalId: remote.externalId, replySentAt: current.replySentAt ?? remote.sentAt ?? now, replyPublishState: remote.state, repliedById: attempt?.actorId ?? current.repliedById } });
      const key = attempt ? `app-review:${attempt.id}:published` : `app-review:${review.id}:imported:${remote.externalId}:published`;
      return remote.state === "PUBLISHED" ? reviewEvent(updated, review.app, review.workspace.slug, "app_review.replied", key, tx) : null;
    }); await event?.afterCommit();
  } catch { /* Keep pending state; the next scheduled pass reads it again. */ }
}

import "server-only";
import { randomUUID } from "node:crypto";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { canManageSocial, canConnectSocial } from "@/lib/roles";
import type { WorkspaceContext } from "@/lib/permissions";
import { recordAuditEvent } from "@/lib/audit";
import { dispatch } from "@/lib/notify";
import { moderationActions, replyError } from "./config";
import { socialToken } from "./tokens";
import { client, endpoint, jsonBody, SocialApiError } from "./http";
import { object, string } from "./types";
import { META } from "./providers/meta";
import { YT } from "./providers/youtube";
import { LI, linkedinReplyBody } from "./providers/linkedin";
import { XAPI } from "./providers/x";
export const commentInput = z.object({ id: z.string().min(1).max(100), operation: z.enum(["reply", "hide", "unhide", "delete", "reject", "seen", "assign"]), text: z.string().max(30000).default(""), assigneeId: z.string().max(100).nullable().optional() });
export async function changeComment(ctx: WorkspaceContext, raw: unknown) {
  if (!canManageSocial(ctx.membership)) return { ok: false as const, error: "Your role cannot manage social comments." };
  const parsed = commentInput.safeParse(raw); if (!parsed.success) return { ok: false as const, error: "Check the comment fields and try again." };
  const input = parsed.data, workspaceId = ctx.workspace.id;
  // Recheck current membership before an external write, including callers outside Server Actions.
  const member = await activeMemberOrSuperAdmin(prisma, ctx);
  if (!member || member.role === "GUEST") return { ok: false as const, error: "This workspace is unavailable." };
  const comment = await prisma.socialComment.findFirst({ where: { workspaceId, id: input.id }, include: { account: true, post: { select: { externalId: true } } } });
  if (!comment) return { ok: false as const, error: "That comment is unavailable." };
  if (input.operation === "seen" || input.operation === "assign") {
    if (input.operation === "assign" && input.assigneeId && !await prisma.membership.findFirst({ where: { workspaceId, userId: input.assigneeId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MEMBER"] }, user: { disabledAt: null } } })) return { ok: false as const, error: "Choose an active teammate in this workspace." };
    await prisma.$transaction(async tx => {
      await tx.socialComment.updateMany({ where: { workspaceId, id: comment.id, ...(input.operation === "seen" ? { status: "NEW" as const } : {}) }, data: input.operation === "seen" ? { status: "SEEN" } : { assigneeId: input.assigneeId || null } });
      await recordAuditEvent({ workspaceId, actorId: ctx.user.id, action: `social.comment_${input.operation}`, targetType: "socialComment", targetId: comment.id, client: tx });
    }); return { ok: true as const };
  }
  if (["DISCONNECTED", "DEMO", "RECONNECT"].includes(comment.account.status)) return { ok: false as const, error: "Connect this account before sending or moderating comments." };
  if (comment.account.failures > 0 && comment.account.nextSyncAt.getTime() > Date.now()) return { ok: false as const, error: "This account is waiting after a platform error. Try after the next sync time in Social settings." };
  const text = input.text.trim();
  if (input.operation === "reply") { const error = replyError(comment.account.platform, text); if (error) return { ok: false as const, error }; if (comment.status === "DELETED" || comment.status === "HIDDEN") return { ok: false as const, error: "This comment is hidden or deleted. Open the original discussion." }; }
  else if (!moderationActions(comment.account.platform).includes(input.operation)) return { ok: false as const, error: "This platform does not allow that moderation action here." };
  if (input.operation === "reply" && comment.account.platform === "LINKEDIN" && !comment.externalId.startsWith("urn:li:comment:")) return { ok: false as const, error: "LinkedIn did not return a replyable comment id. Open the original discussion to answer it." };
  const operationToken = randomUUID();
  const claimed = await prisma.socialComment.updateMany({ where: { workspaceId, id: comment.id, operationToken: null, ...(input.operation === "reply" ? { replyState: { in: ["NONE", "FAILED"] } } : {}) }, data: { operationToken, operationAt: new Date(), ...(input.operation === "reply" ? { replyState: "SENDING", replyText: text, repliedById: ctx.user.id, lastReplyError: null } : {}) } });
  if (!claimed.count) return { ok: false as const, error: "This comment has a pending operation or a recorded reply. Check the original discussion before trying again." };
  try {
    const token = await socialToken(comment.account), api = client(token); const enc = encodeURIComponent; let externalId: string | undefined;
    if (input.operation === "reply") {
      let data: Record<string, unknown>;
      if (comment.account.platform === "YOUTUBE") data = await api(endpoint(YT, "comments", { part: "snippet" }), jsonBody({ snippet: { parentId: comment.parentExternalId ?? comment.externalId, textOriginal: text } }));
      else if (comment.account.platform === "FACEBOOK" || comment.account.platform === "INSTAGRAM") data = await api(endpoint(META, `${enc(comment.externalId)}/${comment.account.platform === "INSTAGRAM" ? "replies" : "comments"}`), jsonBody({ message: text }));
      else if (comment.account.platform === "LINKEDIN") data = await api(endpoint(LI, `socialActions/${enc(comment.externalId)}/comments`), jsonBody(linkedinReplyBody(comment.account.externalId, comment.post.externalId, comment.externalId, text)));
      else data = await api(endpoint(XAPI, "tweets"), jsonBody({ text, reply: { in_reply_to_tweet_id: comment.externalId } }));
      externalId = string(data.commentUrn ?? data.id ?? object(data.data).id) || undefined;
      if (!externalId) throw new SocialApiError("The platform accepted the request without a reply id. Check the original discussion before trying again.", "UNKNOWN");
    } else if (comment.account.platform === "YOUTUBE") {
      // heldForReview is reversible; rejected cannot be republished.
      // https://developers.google.com/youtube/v3/docs/comments/setModerationStatus
      await api(endpoint(YT, "comments/setModerationStatus", { id: comment.externalId, moderationStatus: input.operation === "unhide" ? "published" : input.operation === "reject" ? "rejected" : "heldForReview" }), { method: "POST" });
    } else { await api(endpoint(META, enc(comment.externalId)), input.operation === "delete" ? { method: "DELETE" } : jsonBody(comment.account.platform === "INSTAGRAM" ? { hide: input.operation === "hide" } : { is_hidden: input.operation === "hide" })); }
    await prisma.$transaction(async tx => {
      const data = input.operation === "reply" ? { status: "REPLIED" as const, replyState: "SENT", replyExternalId: externalId, repliedAt: new Date(), lastReplyError: null } : { status: input.operation === "delete" || input.operation === "reject" ? "DELETED" as const : input.operation === "hide" ? "HIDDEN" as const : comment.replyExternalId ? "REPLIED" as const : "SEEN" as const };
      await tx.socialComment.updateMany({ where: { workspaceId, id: comment.id, operationToken }, data: { ...data, operationToken: null, operationAt: null, lastReplyError: null } });
      await recordAuditEvent({ workspaceId, actorId: ctx.user.id, action: `social.comment_${input.operation}`, targetType: "socialComment", targetId: comment.id, client: tx });
    }); return { ok: true as const };
  } catch (e) {
    const error = e instanceof SocialApiError ? e : new SocialApiError("The operation could not be confirmed. Check the original discussion before trying again.", "UNKNOWN");
    // Unknown network/DB outcomes stay claimed for manual reconciliation; never resend automatically.
    await prisma.socialComment.updateMany({ where: { workspaceId, id: comment.id, operationToken }, data: { lastReplyError: error.message, ...(input.operation === "reply" ? { replyState: error.kind === "UNKNOWN" ? "UNKNOWN" : "FAILED", lastReplyError: error.message } : {}), ...(error.kind === "UNKNOWN" ? {} : { operationToken: null, operationAt: null }) } });
    if (["RATE_LIMIT", "TOKEN", "ACCESS"].includes(error.kind)) await prisma.socialAccount.updateMany({ where: { workspaceId, id: comment.accountId }, data: { ...(error.kind === "TOKEN" ? { status: "RECONNECT" } : error.kind === "RATE_LIMIT" ? { nextSyncAt: error.retryAt, failures: { increment: 1 }, status: "DEGRADED" } : { status: "DEGRADED" }), lastError: error.message } });
    if (input.operation === "reply") await dispatch(workspaceId, { type: "social.reply.failed", title: "A social reply needs attention", url: `/w/${ctx.workspace.slug}/social/comments/${comment.id}`, data: { accountId: comment.accountId, commentId: comment.id }, dedupeKey: `social-reply:${operationToken}` });
    return { ok: false as const, error: error.message };
  }
}
export async function disconnectAccount(ctx: WorkspaceContext, id: string) {
  if (!canConnectSocial(ctx.membership)) return { ok: false as const, error: "Only admins can disconnect accounts." };
  return prisma.$transaction(async tx => { const result = await tx.socialAccount.updateMany({ where: { workspaceId: ctx.workspace.id, id }, data: { status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null, leaseToken: null, leaseUntil: null, lastError: null } }); if (!result.count) return { ok: false as const, error: "That account is unavailable." }; await recordAuditEvent({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, action: "social.account_disconnected", targetType: "socialAccount", targetId: id, client: tx }); return { ok: true as const }; });
}

export const reconcileInput = z.object({ id: z.string().min(1).max(100), outcome: z.enum(["sent", "not_sent", "moderation_checked"]), externalId: z.string().trim().max(500).default(""), confirmed: z.literal(true) });
/** An admin verifies the remote discussion explicitly; uncertain writes are never retried by a job. */
export async function reconcileComment(ctx: WorkspaceContext, raw: unknown) {
  if (!canConnectSocial(ctx.membership)) return { ok: false as const, error: "Only admins can reconcile an uncertain request." };
  const parsed = reconcileInput.safeParse(raw); if (!parsed.success) return { ok: false as const, error: "Confirm that you checked the original discussion." };
  const input = parsed.data;
  return prisma.$transaction(async tx => {
    const live = await activeMemberOrSuperAdmin(tx, ctx); if (!live || !["OWNER", "ADMIN"].includes(live.role)) return { ok: false as const, error: "Only active admins can reconcile a request." };
    const comment = await tx.socialComment.findFirst({ where: { workspaceId: ctx.workspace.id, id: input.id, operationToken: { not: null } } }); if (!comment) return { ok: false as const, error: "There is no uncertain request to reconcile." };
    if (comment.replyState === "SENDING" && comment.operationAt && comment.operationAt.getTime() > Date.now() - 600000) return { ok: false as const, error: "This request may still be running. Wait 10 minutes before reconciling." };
    if (input.outcome === "sent" && (!input.externalId || !comment.replyText)) return { ok: false as const, error: "Enter the platform reply id after checking the original discussion." };
    if (input.outcome === "moderation_checked" && ["UNKNOWN", "SENDING"].includes(comment.replyState)) return { ok: false as const, error: "Choose the verified reply outcome." };
    const data = input.outcome === "sent" ? { status: "REPLIED" as const, replyState: "SENT", replyExternalId: input.externalId, repliedAt: new Date() } : input.outcome === "not_sent" ? { replyState: "NONE", replyText: null, replyExternalId: null, repliedById: null, repliedAt: null } : {};
    const result = await tx.socialComment.updateMany({ where: { workspaceId: ctx.workspace.id, id: comment.id, operationToken: comment.operationToken }, data: { ...data, operationToken: null, operationAt: null, lastReplyError: null } });
    if (!result.count) return { ok: false as const, error: "This request was already reconciled. Refresh the page." };
    await recordAuditEvent({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, action: "social.request_reconciled", targetType: "socialComment", targetId: comment.id, metadata: { outcome: input.outcome }, client: tx }); return { ok: true as const };
  });
}

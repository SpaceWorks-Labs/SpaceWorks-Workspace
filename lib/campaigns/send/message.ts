import { prisma } from "@/lib/db";
import { describeOperationalError } from "@/lib/redactSensitiveText";
import { campaignHeaders } from "@/lib/campaigns/headers";
import { fillPlaceholders, placeholderValues } from "@/lib/campaigns/render";
import { messageLinks } from "@/lib/campaigns/send/urls";
import { recordBounce } from "@/lib/campaigns/bounce/record";
import { classifySendError } from "@/lib/campaigns/transport";
import type { SendContext } from "@/lib/campaigns/send/context";

export const MAX_ATTEMPTS = 3;
/** Retry delays after each failed attempt (1m, 5m, 30m). With MAX_ATTEMPTS = 3 a third failure is final, so 30m only applies if the limit is raised. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

/** "bounced": the relay accepted the session but refused the recipient (a bad address, not a broken relay). */
export type MessageOutcome = "sent" | "skipped" | "retry" | "failed" | "bounced";

/** Process one claimed message end to end. */
export async function processMessage(ctx: SendContext, messageId: string): Promise<MessageOutcome> {
  const { campaign } = ctx;
  const message = await prisma.campaignMessage.findFirst({
    where: { id: messageId, campaignId: campaign.id, workspaceId: campaign.workspaceId, status: "CLAIMED" },
    include: { subscriber: { include: { subscriptions: { where: { status: "CONFIRMED", listId: { in: ctx.listIds } }, select: { listId: true } } } } },
  });
  if (!message) return "skipped";
  const subscriber = message.subscriber;
  if (!subscriber || subscriber.workspaceId !== campaign.workspaceId || subscriber.status !== "ACTIVE" || subscriber.subscriptions.length === 0) {
    await prisma.campaignMessage.updateMany({ where: { id: message.id, status: "CLAIMED" }, data: { status: "SKIPPED", lastError: "No longer subscribed." } });
    return "skipped";
  }
  const links = messageLinks(ctx.base, { workspaceId: campaign.workspaceId, messageId: message.id, subscriberId: subscriber.id });
  const values = {
    ...placeholderValues(subscriber, { workspaceName: ctx.workspaceName, unsubscribeUrl: links.unsubscribeUrl, preferencesUrl: links.preferencesUrl }),
    open_token: links.openToken,
    click_token: links.clickToken,
  };
  try {
    const result = await ctx.sender.send({
      to: subscriber.email,
      subject: fillPlaceholders(campaign.subject, values, "header"),
      html: fillPlaceholders(ctx.html, values, "html"),
      text: fillPlaceholders(ctx.text, values, "text"),
      headers: campaignHeaders({ unsubscribeUrl: links.unsubscribeUrl, messageId: message.id, domain: ctx.sender.domain, ref: message.token }),
      messageId: message.id,
      fromName: campaign.fromName,
      replyTo: campaign.replyTo,
    });
    await prisma.campaignMessage.updateMany({ where: { id: message.id, status: "CLAIMED" }, data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId, lastError: null } });
    return "sent";
  } catch (error) {
    return recordFailure(ctx, message.id, message.attempts + 1, subscriber.email, error);
  }
}

async function recordFailure(ctx: SendContext, messageId: string, attempts: number, email: string, error: unknown): Promise<MessageOutcome> {
  const diagnostic = describeOperationalError(error).slice(0, 500);
  if (classifySendError(error) === "hard") {
    const res = await prisma.campaignMessage.updateMany({ where: { id: messageId, status: "CLAIMED" }, data: { status: "FAILED", attempts, lastError: diagnostic } });
    // The bounce policy (HARD blocklists the subscriber and marks a linked contact do-not-contact) lives in recordBounce.
    if (res.count > 0) await recordBounce(ctx.campaign.workspaceId, { email, kind: "HARD", source: "SMTP_REJECT", diagnostic, campaignId: ctx.campaign.id, messageId });
    return "bounced";
  }
  if (attempts >= MAX_ATTEMPTS) {
    await prisma.campaignMessage.updateMany({ where: { id: messageId, status: "CLAIMED" }, data: { status: "FAILED", attempts, lastError: diagnostic } });
    return "failed";
  }
  const delay = BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
  await prisma.campaignMessage.updateMany({ where: { id: messageId, status: "CLAIMED" }, data: { status: "PENDING", claimedAt: null, attempts, nextAttemptAt: new Date(Date.now() + delay), lastError: diagnostic } });
  return "retry";
}

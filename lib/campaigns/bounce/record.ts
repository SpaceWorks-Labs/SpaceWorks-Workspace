import "server-only";

import type { BounceKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auditCampaignEvent } from "../audit";
import { blocklistSubscriber } from "../blocklist";
import { blocklistReasonForBounce, normaliseEmail, SOFT_BOUNCE_WINDOW_DAYS } from "../policy";
import { getCampaignSettings } from "../settings";

export type BounceEvent = {
  email: string;
  kind: BounceKind;
  /** SES, POSTMARK, SMTP_REJECT, MANUAL. */
  source: string;
  diagnostic?: string | null;
  /** Provider's id for this event; a repeat of the same id is ignored. */
  providerEventId?: string | null;
  campaignId?: string | null;
  messageId?: string | null;
};

export type BounceOutcome = "recorded" | "duplicate" | "unknown_subscriber";

/**
 * Apply one bounce or complaint to a subscriber. HARD and COMPLAINT blocklist
 * at once (and mark a linked contact do-not-contact); SOFT blocklists when
 * `softBounceLimit` land within 30 days. Deduplicated on `providerEventId`.
 * The audit event carries the kind and source only, never the address.
 */
export async function recordBounce(workspaceId: string, event: BounceEvent): Promise<BounceOutcome> {
  const email = normaliseEmail(event.email);
  const settings = await getCampaignSettings(workspaceId);
  return prisma.$transaction(async (tx) => {
    if (event.providerEventId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campaign:bounce:${workspaceId}:${event.providerEventId}`}))`;
      if (await tx.campaignBounce.findFirst({ where: { workspaceId, providerEventId: event.providerEventId }, select: { id: true } })) return "duplicate";
    }
    const subscriber = await tx.subscriber.findUnique({ where: { workspaceId_email: { workspaceId, email } } });
    if (!subscriber) return "unknown_subscriber";
    const last = event.messageId || event.campaignId ? null : await tx.campaignMessage.findFirst({ where: { workspaceId, subscriberId: subscriber.id, status: "SENT" }, orderBy: { sentAt: "desc" }, select: { id: true, campaignId: true } });
    await tx.campaignBounce.create({ data: { workspaceId, subscriberId: subscriber.id, campaignId: event.campaignId ?? last?.campaignId ?? null, messageId: event.messageId ?? last?.id ?? null, kind: event.kind, source: event.source, diagnostic: event.diagnostic?.slice(0, 500) ?? null, providerEventId: event.providerEventId ?? null } });
    const since = new Date(Date.now() - SOFT_BOUNCE_WINDOW_DAYS * 86_400_000);
    const recentSoft = event.kind === "SOFT" ? await tx.campaignBounce.count({ where: { workspaceId, subscriberId: subscriber.id, kind: "SOFT", createdAt: { gte: since } } }) : 0;
    await tx.subscriber.update({ where: { id: subscriber.id }, data: { bounceCount: event.kind === "SOFT" ? recentSoft : { increment: 1 } } });
    const reason = blocklistReasonForBounce(event.kind, recentSoft, settings.softBounceLimit);
    if (reason) {
      await blocklistSubscriber(tx, workspaceId, subscriber.id, reason);
      if (event.kind !== "SOFT" && subscriber.contactId) await tx.contact.updateMany({ where: { id: subscriber.contactId, workspaceId }, data: { doNotContact: true } });
    }
    await auditCampaignEvent({ client: tx, workspaceId, action: "bounce", targetType: "Subscriber", targetId: subscriber.id, metadata: { kind: event.kind, source: event.source } });
    return "recorded";
  });
}

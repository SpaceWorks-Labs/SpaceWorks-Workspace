import "server-only";

import { prisma, type DbClient } from "@/lib/db";
import { verifyCampaignToken } from "../tokens";
import { blocklistSubscriber, denyContactConsent, hasNoActiveSubscriptions } from "../blocklist";
import { auditCampaignEvent } from "../audit";
import { resolvePublicWorkspace } from "./gate";

export type UnsubscribeTarget = { workspaceId: string; subscriberId: string; listIds: string[]; workspaceName: string };

/**
 * Resolve an unsubscribe token to a subscriber and the lists it speaks for:
 * the message's campaign lists, or the single list named in the token. The
 * workspace id inside the token is re-checked against the database row, and
 * the workspace must be active with the campaigns module on.
 */
export async function resolveUnsubscribeTarget(token: string, db: DbClient = prisma): Promise<UnsubscribeTarget | null> {
  const payload = verifyCampaignToken(token, "unsub");
  if (!payload) return null;
  const workspace = await resolvePublicWorkspace({ id: payload.workspaceId });
  if (!workspace) return null;
  if (payload.messageId) {
    const message = await db.campaignMessage.findFirst({ where: { id: payload.messageId, workspaceId: workspace.id }, select: { subscriberId: true, campaign: { select: { lists: { select: { listId: true } } } } } });
    if (!message?.subscriberId) return null;
    return { workspaceId: workspace.id, subscriberId: message.subscriberId, listIds: message.campaign.lists.map((l) => l.listId), workspaceName: workspace.name };
  }
  if (!payload.subscriberId) return null;
  const subscriber = await db.subscriber.findFirst({ where: { id: payload.subscriberId, workspaceId: workspace.id }, select: { id: true } });
  return subscriber ? { workspaceId: workspace.id, subscriberId: subscriber.id, listIds: payload.listId ? [payload.listId] : [], workspaceName: workspace.name } : null;
}

/** Unsubscribe from some lists. Writes consent back to the source contact once nothing active remains. */
export async function unsubscribeFromLists(target: Pick<UnsubscribeTarget, "workspaceId" | "subscriberId" | "listIds">, source: string, db: typeof prisma = prisma): Promise<number> {
  return db.$transaction(async (tx) => {
    const result = await tx.listSubscription.updateMany({
      where: { workspaceId: target.workspaceId, subscriberId: target.subscriberId, listId: { in: target.listIds }, status: { not: "UNSUBSCRIBED" } },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date(), unsubscribeSource: source, confirmTokenHash: null, confirmTokenExpiresAt: null },
    });
    if (result.count && (await hasNoActiveSubscriptions(tx, target.workspaceId, target.subscriberId))) {
      const subscriber = await tx.subscriber.findUnique({ where: { id: target.subscriberId }, select: { contactId: true, source: true } });
      if (subscriber) await denyContactConsent(tx, target.workspaceId, subscriber);
    }
    return result.count;
  });
}

/** Unsubscribe from everything: every subscription ends and the subscriber is blocklisted (UNSUBSCRIBE_ALL). */
export async function unsubscribeEverywhere(workspaceId: string, subscriberId: string, source: string, db: typeof prisma = prisma): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.listSubscription.updateMany({ where: { workspaceId, subscriberId, status: { not: "UNSUBSCRIBED" } }, data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date(), unsubscribeSource: source, confirmTokenHash: null, confirmTokenExpiresAt: null } });
    await blocklistSubscriber(tx, workspaceId, subscriberId, "UNSUBSCRIBE_ALL");
    const subscriber = await tx.subscriber.findUnique({ where: { id: subscriberId }, select: { contactId: true, source: true } });
    if (subscriber) await denyContactConsent(tx, workspaceId, subscriber);
    await auditCampaignEvent({ client: tx, workspaceId, action: "subscriber_blocklisted", targetType: "Subscriber", targetId: subscriberId, metadata: { reason: "UNSUBSCRIBE_ALL", source } });
  });
}

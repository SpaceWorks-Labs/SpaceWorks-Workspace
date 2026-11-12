import "server-only";

import type { DbClient } from "@/lib/db";
import type { BlocklistReason } from "./policy";

/** Blocklist one subscriber. Idempotent: an already blocklisted subscriber keeps its first reason. */
export async function blocklistSubscriber(db: DbClient, workspaceId: string, subscriberId: string, reason: BlocklistReason): Promise<boolean> {
  const result = await db.subscriber.updateMany({ where: { id: subscriberId, workspaceId, status: "ACTIVE" }, data: { status: "BLOCKLISTED", blocklistedAt: new Date(), blocklistReason: reason } });
  return result.count > 0;
}

export async function unblocklistSubscriber(db: DbClient, workspaceId: string, subscriberId: string): Promise<boolean> {
  const result = await db.subscriber.updateMany({ where: { id: subscriberId, workspaceId, status: "BLOCKLISTED" }, data: { status: "ACTIVE", blocklistedAt: null, blocklistReason: null, bounceCount: 0 } });
  return result.count > 0;
}

/**
 * A contact turned on "do not contact" or was deleted: blocklist the
 * subscribers made from it (reason CONTACT_DNC). Called from lib/contacts.
 */
export async function blocklistSubscribersForContacts(db: DbClient, workspaceId: string, contactIds: string[], reason: BlocklistReason = "CONTACT_DNC"): Promise<number> {
  if (!contactIds.length) return 0;
  const result = await db.subscriber.updateMany({ where: { workspaceId, contactId: { in: contactIds }, status: "ACTIVE" }, data: { status: "BLOCKLISTED", blocklistedAt: new Date(), blocklistReason: reason } });
  return result.count;
}

/** Write an unsubscribe back to the contact the subscriber was imported from (never to unrelated contacts). */
export async function denyContactConsent(db: DbClient, workspaceId: string, subscriber: { contactId: string | null; source: string | null }): Promise<void> {
  if (!subscriber.contactId || subscriber.source !== "contact") return;
  await db.contact.updateMany({ where: { id: subscriber.contactId, workspaceId }, data: { consentStatus: "DENIED", consentSource: "campaign_unsubscribe", consentAt: new Date() } });
}

/** Unsubscribed from every list and not blocklisted: nothing left that justifies mail. */
export async function hasNoActiveSubscriptions(db: DbClient, workspaceId: string, subscriberId: string): Promise<boolean> {
  return (await db.listSubscription.count({ where: { workspaceId, subscriberId, status: { not: "UNSUBSCRIBED" } } })) === 0;
}

import "server-only";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { idSchema } from "@/lib/validation";
import { auditCampaignEvent } from "./audit";
import { blocklistSubscriber, unblocklistSubscriber } from "./blocklist";
import { getCampaignSettings } from "./settings";
import { validListIds } from "./lists";
import { buildConsent, upsertSubscriber } from "./subscriptions";
import { isDomainBlocked, isValidEmail, normaliseEmail } from "./policy";

export const PAGE_SIZE = 50;

export type SubscriberQuery = { q?: string; status?: "ACTIVE" | "BLOCKLISTED"; listId?: string; page?: number };

export async function querySubscribers(workspaceId: string, query: SubscriberQuery) {
  const where: Prisma.SubscriberWhereInput = {
    workspaceId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.q ? { OR: [{ email: { contains: query.q.trim().toLowerCase().slice(0, 100) } }, { name: { contains: query.q.trim().slice(0, 100), mode: "insensitive" } }] } : {}),
    ...(query.listId ? { subscriptions: { some: { listId: query.listId, workspaceId } } } : {}),
  };
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const [rows, total] = await Promise.all([
    prisma.subscriber.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { subscriptions: { select: { listId: true, status: true } } } }),
    prisma.subscriber.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export const addSubscriberSchema = z.object({
  email: z.string().trim().max(320),
  name: z.string().trim().max(160).default(""),
  listIds: z.array(idSchema).max(50).default([]),
  attest: z.literal(true, { error: "Confirm that you have permission to email this person." }),
});

/** Admin adds one subscriber to lists. Consent is recorded as ADMIN with the attestation. */
export async function addSubscriber(workspaceId: string, actorId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = addSubscriberSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (!isValidEmail(parsed.data.email)) return actionError("Enter a valid email address.", { email: ["Enter a valid email address."] });
  const settings = await getCampaignSettings(workspaceId);
  const email = normaliseEmail(parsed.data.email);
  if (isDomainBlocked(email, settings.domainBlocklist)) return actionError("That domain is on the blocklist.");
  const listIds = await validListIds(workspaceId, parsed.data.listIds);
  const id = await prisma.$transaction(async (tx) => {
    const { subscriber } = await upsertSubscriber(tx, workspaceId, { email, name: parsed.data.name, source: "admin" });
    if (subscriber.status === "ACTIVE") {
      const consent = buildConsent({ source: "ADMIN", text: "Added by an admin who confirmed permission." }, false);
      for (const listId of listIds) {
        const existing = await tx.listSubscription.findUnique({ where: { subscriberId_listId: { subscriberId: subscriber.id, listId } } });
        if (existing && existing.status !== "UNSUBSCRIBED") continue;
        const now = new Date();
        const data = { ...consent, status: "CONFIRMED" as const, confirmedAt: now, subscribedAt: now, unsubscribedAt: null, unsubscribeSource: null };
        await tx.listSubscription.upsert({ where: { subscriberId_listId: { subscriberId: subscriber.id, listId } }, create: { subscriberId: subscriber.id, listId, workspaceId, ...data }, update: data });
      }
    }
    await auditCampaignEvent({ client: tx, workspaceId, actorId, action: "subscriber_added", targetType: "Subscriber", targetId: subscriber.id });
    return subscriber.id;
  });
  return { ok: true, data: { id } };
}

export async function setBlocklisted(workspaceId: string, actorId: string, subscriberId: string, blocked: boolean): Promise<ActionResult> {
  const changed = await prisma.$transaction(async (tx) => {
    const ok = blocked ? await blocklistSubscriber(tx, workspaceId, subscriberId, "ADMIN") : await unblocklistSubscriber(tx, workspaceId, subscriberId);
    if (ok) await auditCampaignEvent({ client: tx, workspaceId, actorId, action: blocked ? "subscriber_blocklisted" : "subscriber_unblocklisted", targetType: "Subscriber", targetId: subscriberId, metadata: { reason: "ADMIN" } });
    return ok;
  });
  return changed ? { ok: true } : actionError("That subscriber is already in that state or no longer exists.");
}

/** Admin moves a subscriber on or off a list. Turning on needs no new email: the admin attests consent. */
export async function setListMembership(workspaceId: string, actorId: string, subscriberId: string, listId: string, on: boolean): Promise<ActionResult> {
  const [subscriber, lists] = await Promise.all([prisma.subscriber.findFirst({ where: { id: subscriberId, workspaceId }, select: { id: true, status: true } }), validListIds(workspaceId, [listId])]);
  if (!subscriber || !lists.length) return actionError("That subscriber or list no longer exists.");
  if (on && subscriber.status !== "ACTIVE") return actionError("This subscriber is blocklisted. Unblocklist them first.");
  const now = new Date();
  const key = { subscriberId_listId: { subscriberId, listId } };
  if (on) {
    const data = { ...buildConsent({ source: "ADMIN", text: "Added to the list by an admin." }, false), status: "CONFIRMED" as const, confirmedAt: now, subscribedAt: now, unsubscribedAt: null, unsubscribeSource: null };
    await prisma.listSubscription.upsert({ where: key, create: { subscriberId, listId, workspaceId, ...data }, update: data });
  } else {
    await prisma.listSubscription.updateMany({ where: { subscriberId, listId, workspaceId }, data: { status: "UNSUBSCRIBED", unsubscribedAt: now, unsubscribeSource: "admin", confirmTokenHash: null, confirmTokenExpiresAt: null } });
  }
  await auditCampaignEvent({ workspaceId, actorId, action: "subscriber_updated", targetType: "Subscriber", targetId: subscriberId });
  return { ok: true };
}

/**
 * GDPR erase: delete the subscriber, its subscriptions, bounces and engagement
 * rows, and scrub the address from sent-message records.
 */
export async function eraseSubscriber(workspaceId: string, actorId: string, subscriberId: string): Promise<ActionResult> {
  const found = await prisma.subscriber.findFirst({ where: { id: subscriberId, workspaceId }, select: { id: true } });
  if (!found) return actionError("That subscriber no longer exists.");
  await prisma.$transaction(async (tx) => {
    const messages = await tx.campaignMessage.findMany({ where: { workspaceId, subscriberId }, select: { id: true } });
    const messageIds = messages.map((m) => m.id);
    if (messageIds.length) await tx.campaignEngagement.deleteMany({ where: { workspaceId, messageId: { in: messageIds } } });
    await tx.campaignMessage.updateMany({ where: { workspaceId, subscriberId }, data: { emailSnapshot: "erased", lastError: null } });
    await tx.campaignBounce.deleteMany({ where: { workspaceId, subscriberId } });
    await tx.subscriber.delete({ where: { id: subscriberId } });
    await auditCampaignEvent({ client: tx, workspaceId, actorId, action: "subscriber_erased", targetType: "Subscriber", targetId: subscriberId });
  });
  return { ok: true };
}

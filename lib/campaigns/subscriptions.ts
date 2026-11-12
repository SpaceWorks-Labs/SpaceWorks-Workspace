import "server-only";

import { Prisma, type MailingList, type Subscriber } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { randomToken, sha256Hex } from "@/lib/crypto";
import { enqueueCampaignConfirmation } from "@/lib/outbox";
import { checkRateLimitById } from "@/lib/rateLimit";
import { signCampaignToken, verifyCampaignToken, CONFIRM_TOKEN_TTL_MS } from "./tokens";
import { confirmUrl } from "./public/urls";
import { emailDomain, normaliseEmail } from "./policy";

export type ConsentSource = "FORM" | "IMPORT" | "ADMIN" | "CONTACT" | "PREFERENCES";

/** Consent fields for a ListSubscription. IP and user agent are stored only when the workspace opted in. */
export function buildConsent(input: { source: ConsentSource; text?: string | null; ip?: string | null; userAgent?: string | null }, recordConsentIp: boolean) {
  return {
    consentSource: input.source,
    consentText: input.text?.slice(0, 500) ?? null,
    consentIp: recordConsentIp ? (input.ip ?? null) : null,
    consentUserAgent: recordConsentIp ? (input.userAgent?.slice(0, 300) ?? null) : null,
  };
}

/** Find or create the subscriber for an address. Never changes status; a known name is kept. */
export async function upsertSubscriber(db: DbClient, workspaceId: string, input: { email: string; name?: string | null; source: string; contactId?: string | null; attributes?: Prisma.InputJsonValue }): Promise<{ subscriber: Subscriber; created: boolean }> {
  const email = normaliseEmail(input.email);
  const existing = await db.subscriber.findUnique({ where: { workspaceId_email: { workspaceId, email } } });
  if (existing) {
    const name = !existing.name && input.name ? input.name.trim().slice(0, 160) : null;
    return { subscriber: name ? await db.subscriber.update({ where: { id: existing.id }, data: { name } }) : existing, created: false };
  }
  try {
    const subscriber = await db.subscriber.create({ data: { workspaceId, email, emailDomain: emailDomain(email), name: input.name?.trim().slice(0, 160) || null, source: input.source, contactId: input.contactId ?? null, attributes: input.attributes ?? {}, publicToken: randomToken(18) } });
    return { subscriber, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const subscriber = await db.subscriber.findUniqueOrThrow({ where: { workspaceId_email: { workspaceId, email } } });
      return { subscriber, created: false };
    }
    throw error;
  }
}

export type SubscribeOutcome = "confirmation_sent" | "already_confirmed" | "pending" | "blocked";

export type SubscribeInput = {
  workspaceId: string;
  workspaceName: string;
  list: Pick<MailingList, "id" | "name">;
  email: string;
  name?: string | null;
  source: ConsentSource;
  consentText: string;
  ip?: string | null;
  userAgent?: string | null;
  recordConsentIp: boolean;
  now?: Date;
};

/** No new confirmation email for the same subscriber and list within this window. */
export const CONFIRM_RESEND_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Subscribe an address from an unauthenticated source (public form or
 * preferences page). Always double opt-in, whatever the list's setting, because
 * anyone can type any address; the list's SINGLE setting only applies to
 * addresses an admin adds or imports. The row stays UNCONFIRMED (or stays
 * UNSUBSCRIBED when the person opted out earlier: only the confirmation link
 * can resubscribe them). One confirmation per subscriber and list per 24 hours,
 * and global per-address and per-workspace daily caps bound the mail sent.
 * Blocklisted subscribers are left alone. The caller replies identically for
 * every outcome so the response never reveals whether an address is known.
 */
export async function subscribeToList(input: SubscribeInput, db: typeof prisma = prisma): Promise<SubscribeOutcome> {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const { subscriber } = await upsertSubscriber(tx, input.workspaceId, { email: input.email, name: input.name, source: input.source.toLowerCase() });
    if (subscriber.status !== "ACTIVE") return "blocked";
    const key = { subscriberId_listId: { subscriberId: subscriber.id, listId: input.list.id } };
    const existing = await tx.listSubscription.findUnique({ where: key });
    if (existing?.status === "CONFIRMED") return "already_confirmed";
    const sentAt = existing?.confirmTokenHash && existing.confirmTokenExpiresAt ? existing.confirmTokenExpiresAt.getTime() - CONFIRM_TOKEN_TTL_MS : null;
    if (sentAt !== null && sentAt > now.getTime() - CONFIRM_RESEND_AFTER_MS) return "pending";
    if (!(await checkRateLimitById("campaignConfirmEmail", sha256Hex(subscriber.email))) || !(await checkRateLimitById("campaignConfirmWorkspace", input.workspaceId))) return "pending";
    const token = signCampaignToken({ purpose: "confirm", workspaceId: input.workspaceId, subscriberId: subscriber.id, listId: input.list.id }, now.getTime());
    const pending = { confirmTokenHash: sha256Hex(token), confirmTokenExpiresAt: new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS) };
    if (existing?.status === "UNSUBSCRIBED") {
      await tx.listSubscription.update({ where: key, data: pending });
    } else {
      const consent = buildConsent({ source: input.source, text: input.consentText, ip: input.ip, userAgent: input.userAgent }, input.recordConsentIp);
      const data = { ...consent, status: "UNCONFIRMED" as const, subscribedAt: now, unsubscribedAt: null, unsubscribeSource: null, confirmedAt: null, ...pending };
      await tx.listSubscription.upsert({ where: key, create: { subscriberId: subscriber.id, listId: input.list.id, workspaceId: input.workspaceId, ...data }, update: data });
    }
    await enqueueCampaignConfirmation(tx, { workspaceId: input.workspaceId, to: subscriber.email, workspaceName: input.workspaceName, listName: input.list.name, confirmUrl: confirmUrl(token), expiresAt: pending.confirmTokenExpiresAt });
    return "confirmation_sent";
  });
}

export type ConfirmPreview = { workspaceId: string; listName: string; workspaceName: string };

/** Validate a confirmation token without consuming it (for the button page). */
export async function previewConfirmation(token: string, db: DbClient = prisma): Promise<ConfirmPreview | null> {
  const payload = verifyCampaignToken(token, "confirm");
  if (!payload?.subscriberId || !payload.listId) return null;
  const row = await db.listSubscription.findFirst({
    where: { subscriberId: payload.subscriberId, listId: payload.listId, workspaceId: payload.workspaceId, status: { in: ["UNCONFIRMED", "UNSUBSCRIBED"] }, confirmTokenHash: sha256Hex(token), confirmTokenExpiresAt: { gt: new Date() }, subscriber: { status: "ACTIVE" } },
    select: { list: { select: { name: true } }, workspace: { select: { name: true } } },
  });
  return row ? { workspaceId: payload.workspaceId, listName: row.list.name, workspaceName: row.workspace.name } : null;
}

/** Confirm a double opt-in. Single use: the stored hash is cleared by the same update that confirms. */
export async function confirmSubscription(token: string, db: DbClient = prisma): Promise<boolean> {
  const payload = verifyCampaignToken(token, "confirm");
  if (!payload?.subscriberId || !payload.listId) return false;
  const now = new Date();
  const result = await db.listSubscription.updateMany({
    where: { subscriberId: payload.subscriberId, listId: payload.listId, workspaceId: payload.workspaceId, status: { in: ["UNCONFIRMED", "UNSUBSCRIBED"] }, confirmTokenHash: sha256Hex(token), confirmTokenExpiresAt: { gt: now }, subscriber: { status: "ACTIVE" } },
    data: { status: "CONFIRMED", confirmedAt: now, unsubscribedAt: null, unsubscribeSource: null, confirmTokenHash: null, confirmTokenExpiresAt: null },
  });
  return result.count === 1;
}

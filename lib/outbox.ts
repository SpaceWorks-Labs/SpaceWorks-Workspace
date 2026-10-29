import "server-only";

import { OutboxStatus, Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { describeOperationalError } from "@/lib/redactSensitiveText";
import { sendRenderedEmail } from "@/lib/email/send";
import {
  renderEmailVerificationEmail,
  renderInviteEmail,
  renderPasswordResetEmail,
  type RenderedEmail,
} from "@/lib/email/templates";

/**
 * Transactional email outbox. Request paths only insert rows (inside their own
 * transaction when they have one); the worker (lib/outboxWorker.ts, plus
 * POST /api/internal/outbox) claims and delivers them with retries.
 *
 * Kinds:
 * - "email": a pre-rendered message. Any feature can queue one with
 *   `enqueueEmail` without touching this file. Never put bearer links in it.
 * - "workspace-invite", "password-reset", "email-verification": carry a
 *   bearer URL, so the row is deleted after delivery or terminal failure.
 * - "notify.deliver": one notification delivery ({ deliveryId }) queued by
 *   `dispatch()` (lib/notify); the adapter sends it and the delivery row
 *   tracks attempts, so this row only mirrors the outcome.
 */

type EmailPayload = { notificationDigestId?: string; notificationDeliveryId?: string; fundingReceipt?: { recordId: string; fileId: string; contactId: string }; workspaceId?: string; to: string; subject: string; html: string; text: string; calendarInvite?: { method: "REQUEST" | "CANCEL"; content: string } };
type InvitePayload = { workspaceId?: string; to: string; workspaceName: string; inviterName?: string | null; role: string; inviteUrl: string; expiresAt: string };
type ResetPayload = { to: string; resetUrl: string; expiresAt: string };
type VerificationPayload = { to: string; verificationUrl: string; expiresAt: string };

const CAPABILITY_KINDS = new Set(["workspace-invite", "password-reset", "email-verification"]);

function create(client: DbClient, kind: string, payload: object) {
  return client.outboxMessage.create({ data: { kind, payload: payload as Prisma.InputJsonValue }, select: { id: true } });
}

export function enqueueEmail(client: DbClient, payload: EmailPayload) {
  return create(client, "email", payload);
}

export function enqueueInviteEmail(client: DbClient, payload: Omit<InvitePayload, "expiresAt"> & { expiresAt: Date }) {
  return create(client, "workspace-invite", { ...payload, expiresAt: payload.expiresAt.toISOString() });
}

export function enqueuePasswordReset(client: DbClient, payload: Omit<ResetPayload, "expiresAt"> & { expiresAt: Date }) {
  return create(client, "password-reset", { ...payload, expiresAt: payload.expiresAt.toISOString() });
}

export function enqueueEmailVerification(client: DbClient, payload: Omit<VerificationPayload, "expiresAt"> & { expiresAt: Date }) {
  return create(client, "email-verification", { ...payload, expiresAt: payload.expiresAt.toISOString() });
}

// ───────────── payload validation ─────────────

function record(value: Prisma.JsonValue): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function isEmail(value: unknown): value is string {
  return isBoundedString(value, 320) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function isIsoDate(value: unknown): value is string {
  return isBoundedString(value, 64) && !Number.isNaN(Date.parse(value));
}
function isSafeUrl(value: unknown): value is string {
  if (!isBoundedString(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:");
  } catch {
    return false;
  }
}

class PermanentOutboxError extends Error {
  override name = "PermanentOutboxError";
}

/** Render a claimed message, or return "expired" for a capability past its expiry. */
export function renderOutboxMessage(kind: string, raw: Prisma.JsonValue, now = new Date()): { to: string; email: RenderedEmail } | "expired" {
  const p = record(raw);
  if (!p || !isEmail(p.to)) throw new PermanentOutboxError();
  if (CAPABILITY_KINDS.has(kind) && (!isIsoDate(p.expiresAt) || new Date(p.expiresAt) <= now)) return "expired";
  switch (kind) {
    case "email":
      if (!isBoundedString(p.subject, 300) || !isBoundedString(p.html, 500_000) || !isBoundedString(p.text, 200_000)) throw new PermanentOutboxError();
      if (p.calendarInvite !== undefined) {
        const invite = p.calendarInvite as Record<string, unknown>;
        if (!invite || !["REQUEST", "CANCEL"].includes(String(invite.method)) || !isBoundedString(invite.content, 100_000) || !invite.content.startsWith("BEGIN:VCALENDAR\r\n")) throw new PermanentOutboxError();
        return { to: p.to, email: { subject: p.subject, html: p.html, text: p.text, calendarInvite: { method: invite.method as "REQUEST" | "CANCEL", content: invite.content } } };
      }
      return { to: p.to, email: { subject: p.subject, html: p.html, text: p.text } };
    case "workspace-invite":
      if (!isBoundedString(p.workspaceName, 120) || !isBoundedString(p.role, 16) || !isSafeUrl(p.inviteUrl)) throw new PermanentOutboxError();
      return {
        to: p.to,
        email: renderInviteEmail({
          workspaceName: p.workspaceName,
          inviterName: typeof p.inviterName === "string" ? p.inviterName.slice(0, 120) : null,
          role: p.role,
          inviteUrl: p.inviteUrl,
          expiresAt: new Date(p.expiresAt as string),
        }),
      };
    case "password-reset":
      if (!isSafeUrl(p.resetUrl)) throw new PermanentOutboxError();
      return { to: p.to, email: renderPasswordResetEmail({ resetUrl: p.resetUrl }) };
    case "email-verification":
      if (!isSafeUrl(p.verificationUrl)) throw new PermanentOutboxError();
      return { to: p.to, email: renderEmailVerificationEmail({ verificationUrl: p.verificationUrl }) };
    default:
      throw new PermanentOutboxError();
  }
}

function retryDelayMs(kind: string, attempts: number) {
  const exponential = 2 ** attempts * 60_000;
  // Reset/verification links expire after an hour; keep retries inside that window.
  return Math.min(kind === "password-reset" || kind === "email-verification" ? 8 * 60_000 : 60 * 60_000, exponential);
}

const MAX_ATTEMPTS = 8;

/** Must equal NOTIFY_DELIVER_KIND in lib/notify/dispatch.ts (kept literal to avoid an import cycle). */
const NOTIFY_JOB_KIND = "notify.deliver";

/** Run one notification delivery; never throws (a crash becomes a retry). */
async function runNotifyJob(payload: Prisma.JsonValue): Promise<{ status: "done" } | { status: "retry"; delayMs: number; error: string } | { status: "failed"; error: string }> {
  const deliveryId = record(payload)?.deliveryId;
  if (typeof deliveryId !== "string" || deliveryId.length > 64) return { status: "failed", error: "Malformed notification job." };
  try {
    const { processNotifyDelivery } = await import("@/lib/notify/deliver");
    return await processNotifyDelivery(deliveryId);
  } catch (error) {
    return { status: "retry", delayMs: 60_000, error: describeOperationalError(error) };
  }
}

/** Deliver a small batch. Safe to run concurrently: each row is claimed with a conditional update. */
export async function deliverOutboxBatch(limit = 20, scope: { ids?: string[] } = {}) {
  const scoped = scope.ids ? { id: { in: scope.ids } } : {};
  // Return stale claims (worker died mid-send) to the queue first.
  await prisma.outboxMessage.updateMany({
    where: { ...scoped, status: OutboxStatus.PROCESSING, lockedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    data: { status: OutboxStatus.PENDING, lockedAt: null },
  });

  const messages = await prisma.outboxMessage.findMany({
    where: { ...scoped, status: OutboxStatus.PENDING, availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
  });

  let sent = 0;
  let failed = 0;
  for (const message of messages) {
    const claimTime = new Date();
    const claim = await prisma.outboxMessage.updateMany({
      where: { id: message.id, status: OutboxStatus.PENDING },
      data: { status: OutboxStatus.PROCESSING, lockedAt: claimTime, attempts: { increment: 1 } },
    });
    if (claim.count !== 1) continue;
    const mine = { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime };
    const isCapability = CAPABILITY_KINDS.has(message.kind);

    if (message.kind === NOTIFY_JOB_KIND) {
      const outcome = await runNotifyJob(message.payload);
      if (outcome.status === "done") {
        await prisma.outboxMessage.updateMany({ where: mine, data: { status: OutboxStatus.SENT, sentAt: new Date(), lockedAt: null, lastError: null } });
        sent += 1;
      } else {
        await prisma.outboxMessage.updateMany({
          where: mine,
          data:
            outcome.status === "retry"
              ? { status: OutboxStatus.PENDING, availableAt: new Date(Date.now() + outcome.delayMs), lockedAt: null, lastError: outcome.error }
              : { status: OutboxStatus.FAILED, lockedAt: null, lastError: outcome.error },
        });
        failed += 1;
      }
      continue;
    }

    try {
      const notificationDigestId = record(message.payload)?.notificationDigestId;
      if (notificationDigestId !== undefined) {
        const { mayDeliverDigest } = await import("@/lib/notify/access");
        if (message.kind !== "email" || typeof notificationDigestId !== "string"
          || !await mayDeliverDigest(notificationDigestId, String(record(message.payload)?.to))) {
          await prisma.outboxMessage.deleteMany({ where: mine });
          continue;
        }
      }
      const notificationDeliveryId = record(message.payload)?.notificationDeliveryId;
      if (notificationDeliveryId !== undefined) {
        const { mayDeliverNotification } = await import("@/lib/notify/access");
        if (message.kind !== "email" || typeof notificationDeliveryId !== "string"
          || !await mayDeliverNotification(notificationDeliveryId, String(record(message.payload)?.to))) {
          await prisma.outboxMessage.deleteMany({ where: mine });
          continue;
        }
      }
      const rendered = message.kind === "analytics.email"
        ? await (await import("@/lib/analytics/email")).renderAnalyticsEmail(message.payload)
        : message.kind === "documents.email"
        ? await (await import("@/lib/documents/email")).renderDocumentEmail(message.payload)
        : renderOutboxMessage(message.kind, message.payload);
      if (rendered === "expired") {
        await prisma.outboxMessage.deleteMany({ where: mine });
        failed += 1;
        continue;
      }
      const receipt = record(message.payload)?.fundingReceipt;
      let attachments: Awaited<ReturnType<typeof import("@/lib/funding/email").fundingReceiptAttachment>>[] = [];
      if (receipt !== undefined) {
        const workspaceId = record(message.payload)?.workspaceId;
        if (message.kind !== "email" || typeof workspaceId !== "string") throw new PermanentOutboxError();
        const { fundingReceiptAttachment } = await import("@/lib/funding/email");
        attachments = [await fundingReceiptAttachment(workspaceId, receipt, rendered.to)];
      }
      await sendRenderedEmail(rendered.to, { ...rendered.email, attachments: [...(rendered.email.attachments ?? []), ...attachments] }, `<sww-${message.id}@outbox.invalid>`);
      if (isCapability) {
        await prisma.outboxMessage.deleteMany({ where: mine });
      } else {
        await prisma.outboxMessage.updateMany({ where: mine, data: { status: OutboxStatus.SENT, sentAt: new Date(), lockedAt: null, lastError: null } });
      }
      sent += 1;
    } catch (error) {
      const attempts = message.attempts + 1;
      const terminal = error instanceof PermanentOutboxError || attempts >= MAX_ATTEMPTS;
      if (isCapability && terminal) {
        await prisma.outboxMessage.deleteMany({ where: mine });
      } else {
        await prisma.outboxMessage.updateMany({
          where: mine,
          data: {
            status: terminal ? OutboxStatus.FAILED : OutboxStatus.PENDING,
            availableAt: new Date(Date.now() + retryDelayMs(message.kind, attempts)),
            lockedAt: null,
            lastError: describeOperationalError(error),
          },
        });
      }
      failed += 1;
    }
  }
  return { sent, failed };
}

/** Counts for the super-admin outbox health panel. */
export async function getOutboxHealth() {
  const [grouped, oldestPending, recentFailures, heartbeat] = await Promise.all([
    prisma.outboxMessage.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.outboxMessage.findFirst({ where: { status: OutboxStatus.PENDING }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.outboxMessage.findMany({
      where: { status: OutboxStatus.FAILED },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, kind: true, attempts: true, lastError: true, createdAt: true },
    }),
    prisma.operationalHeartbeat.findUnique({ where: { key: "outbox-scheduler" } }),
  ]);
  const counts = Object.fromEntries(Object.values(OutboxStatus).map((status) => [status, 0])) as Record<OutboxStatus, number>;
  for (const row of grouped) counts[row.status] = row._count._all;
  return { counts, oldestPendingAt: oldestPending?.createdAt ?? null, recentFailures, heartbeat };
}

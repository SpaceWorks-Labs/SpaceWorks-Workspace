import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DESTINATION_ADAPTERS, PERSONAL_CHANNEL_ADAPTERS } from "@/lib/notify/adapters";
import type { AdapterSendInput, DestinationAdapter, ExternalPersonalChannel, SendResult } from "@/lib/notify/adapters/types";
import { fromDbSeverity } from "@/lib/notify/match";
import { DM_CHANNEL_PROVIDER } from "@/lib/notify/preferences";
import { renderMessage, type StoredEventForRender } from "@/lib/notify/render";
import { describeOperationalError } from "@/lib/redactSensitiveText";
import { mayDeliverNotification } from "./access";

/**
 * Worker side of notification routing: the outbox calls
 * `processNotifyDelivery` for each "notify.deliver" job. Retries back off
 * 30 s, 2 m, 10 m, 30 m, 2 h, 6 h (or the provider's Retry-After) for at most
 * six attempts. A shared destination that fails for good is marked ERROR and
 * admins get one "destination.failing" alert per destination per day.
 */

export type NotifyJobOutcome = { status: "done" } | { status: "retry"; delayMs: number; error: string } | { status: "failed"; error: string };

export const MAX_DELIVERY_ATTEMPTS = 6;
const BACKOFF_SEC = [30, 120, 600, 1800, 7200, 21600];

export function retryDelayMs(attempts: number, retryAfterSec?: number) {
  if (retryAfterSec && retryAfterSec > 0) return Math.min(retryAfterSec, 6 * 3600) * 1000;
  return BACKOFF_SEC[Math.min(Math.max(attempts, 1), BACKOFF_SEC.length) - 1]! * 1000;
}

function storedEvent(record: { type: string; severity: Parameters<typeof fromDbSeverity>[0]; title: string; payload: Prisma.JsonValue }): StoredEventForRender {
  const payload = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload) ? (record.payload as Record<string, unknown>) : {};
  const list = <T>(value: unknown) => (Array.isArray(value) ? (value as T[]) : []);
  return {
    type: record.type,
    severity: fromDbSeverity(record.severity),
    title: record.title,
    body: typeof payload.body === "string" ? payload.body : null,
    url: typeof payload.url === "string" ? payload.url : null,
    fields: list<{ label: string; value: string }>(payload.fields).filter((f) => typeof f?.label === "string" && typeof f?.value === "string"),
    actions: list<{ id: string; label: string; url?: string }>(payload.actions).filter((a) => typeof a?.id === "string" && typeof a?.label === "string"),
  };
}

async function finish(id: string, data: Prisma.NotificationDeliveryUpdateManyMutationInput) {
  await prisma.notificationDelivery.updateMany({ where: { id, status: "SENDING" }, data });
}

export async function processNotifyDelivery(deliveryId: string, now = new Date()): Promise<NotifyJobOutcome> {
  const claim = await prisma.notificationDelivery.updateMany({
    where: { id: deliveryId, status: { in: ["PENDING", "SENDING"] } },
    data: { status: "SENDING", attempts: { increment: 1 }, lastAttemptAt: now },
  });
  if (claim.count === 0) return { status: "done" };

  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      event: { select: { id: true, type: true, severity: true, title: true, payload: true } },
      workspace: { select: { id: true, slug: true, name: true } },
      destination: { include: { connection: true } },
    },
  });
  if (!delivery) return { status: "done" };
  const cancel = async (reason: string) => {
    await finish(deliveryId, { status: "CANCELLED", lastError: reason });
    return { status: "done" } as const;
  };
  if (!await mayDeliverNotification(deliveryId)) return cancel("The recipient no longer has access.");

  let adapter: DestinationAdapter;
  let target: AdapterSendInput["target"];
  if (delivery.destination) {
    const destination = delivery.destination;
    if (!destination.enabled && !delivery.isTest) return cancel("The destination is turned off.");
    if (destination.kind === "IN_APP_USERS") return cancel("In-app destinations are delivered when the event is dispatched.");
    adapter = DESTINATION_ADAPTERS[destination.kind];
    target = {
      type: "destination",
      destination: { id: destination.id, name: destination.name, kind: destination.kind, config: destination.config, secretEnc: destination.secretEnc, connection: destination.connection },
    };
  } else if (delivery.userId && delivery.personalChannel && delivery.personalChannel !== "IN_APP") {
    const channel = delivery.personalChannel as ExternalPersonalChannel;
    const membership = await prisma.membership.findFirst({
      where: { workspaceId: delivery.workspaceId, userId: delivery.userId, status: "ACTIVE" },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!membership) return cancel("The member left the workspace.");
    let identity = null;
    if (channel !== "EMAIL") {
      identity = await prisma.externalIdentityLink.findFirst({
        where: { workspaceId: delivery.workspaceId, userId: delivery.userId, provider: DM_CHANNEL_PROVIDER[channel], connection: { status: "ACTIVE" } },
        include: { connection: true },
      });
      if (!identity) return cancel("The member's account is no longer linked.");
    }
    adapter = PERSONAL_CHANNEL_ADAPTERS[channel];
    target = { type: "personal", channel, user: membership.user, identity };
  } else {
    return cancel("The destination was removed.");
  }

  const thread = delivery.threadKey
    ? await prisma.notificationDelivery.findFirst({
        where: {
          id: { not: delivery.id },
          workspaceId: delivery.workspaceId,
          threadKey: delivery.threadKey,
          status: "SENT",
          ...(delivery.destinationId ? { destinationId: delivery.destinationId } : { userId: delivery.userId, personalChannel: delivery.personalChannel }),
        },
        orderBy: { createdAt: "asc" },
        select: { providerMessageId: true, providerThreadId: true },
      })
    : null;

  const message = renderMessage(storedEvent(delivery.event), delivery.workspace);
  let result: SendResult;
  try {
    result = await adapter.send({
      deliveryId: delivery.id,
      event: { id: delivery.event.id, type: delivery.event.type },
      message,
      target,
      thread: delivery.threadKey && thread ? { threadKey: delivery.threadKey, ...thread } : null,
      isTest: delivery.isTest,
    });
  } catch (error) {
    result = { ok: false, retryable: true, error: describeOperationalError(error) };
  }

  if (result.ok) {
    await finish(deliveryId, {
      status: "SENT",
      lastError: null,
      nextAttemptAt: null,
      providerMessageId: result.providerMessageId ?? null,
      providerThreadId: result.providerThreadId ?? thread?.providerThreadId ?? null,
    });
    if (delivery.destinationId) {
      await prisma.notificationDestination.updateMany({ where: { id: delivery.destinationId }, data: { health: "OK", lastDeliveryAt: now, lastError: null } });
    }
    return { status: "done" };
  }

  const error = result.error.slice(0, 500);
  const attempts = delivery.attempts;
  if (result.retryable && attempts < MAX_DELIVERY_ATTEMPTS) {
    const delayMs = retryDelayMs(attempts, result.retryAfterSec);
    await finish(deliveryId, { status: "PENDING", lastError: error, nextAttemptAt: new Date(now.getTime() + delayMs) });
    return { status: "retry", delayMs, error };
  }

  await finish(deliveryId, { status: "FAILED", lastError: error, nextAttemptAt: null });
  if (delivery.destination && !delivery.isTest) {
    await prisma.notificationDestination.updateMany({ where: { id: delivery.destination.id }, data: { health: "ERROR", lastError: error } });
    await alertAdmins(delivery.workspace, delivery.destination, error, now).catch(() => console.error("[notify] failing-destination alert could not be queued"));
  }
  return { status: "failed", error };
}

async function alertAdmins(workspace: { id: string; slug: string }, destination: { id: string; name: string }, error: string, now: Date) {
  const admins = await prisma.membership.findMany({ where: { workspaceId: workspace.id, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } });
  if (admins.length === 0) return;
  const { dispatch } = await import("@/lib/notify/dispatch");
  await dispatch(workspace.id, {
    type: "destination.failing",
    title: `Notifications to ${destination.name} are failing`,
    body: `${error} Check the destination in notification settings.`,
    url: `/w/${encodeURIComponent(workspace.slug)}/settings/notifications`,
    recipients: admins.map((admin) => admin.userId),
    dedupeKey: `destination:${destination.id}:failing:${now.toISOString().slice(0, 10)}`,
    dedupeWindowSec: 86_400,
    resource: { type: "notification_destination", id: destination.id },
    data: { destinationId: destination.id, error },
  });
}

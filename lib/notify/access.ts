import "server-only";

import { prisma } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";
import { EVENT_CATALOG, type EventType } from "./events";
import { mayReceiveDestinationEmail } from "./audience";

async function mayReceive(workspaceId: string, userId: string, eventType: string, recipientEmail?: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: {
      role: true, status: true, user: { select: { disabledAt: true, email: true } },
      workspace: { select: { archivedAt: true } },
    },
  });
  const spec = EVENT_CATALOG[eventType as EventType];
  return Boolean(spec && membership?.status === "ACTIVE" && !membership.user.disabledAt && !membership.workspace.archivedAt
    && (!spec.minRole || hasRoleAtLeast(membership.role, spec.minRole))
    && (!recipientEmail || membership.user.email.toLowerCase() === recipientEmail.toLowerCase()));
}

export async function mayDeliverDigest(digestId: string, recipientEmail: string) {
  const digest = await prisma.notificationDigestItem.findUnique({ where: { id: digestId }, select: { workspaceId: true, userId: true } });
  return Boolean(digest && await mayReceive(digest.workspaceId, digest.userId, "digest.ready", recipientEmail));
}

/** Recheck queued notifications at routing and current recipient/config at SMTP. */
export async function mayDeliverNotification(deliveryId: string, recipientEmail?: string): Promise<boolean> {
  const delivery = await prisma.notificationDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      workspaceId: true, userId: true, destinationId: true, status: true,
      workspace: { select: { archivedAt: true } },
      event: { select: { type: true } },
      destination: { select: { workspaceId: true, enabled: true, kind: true, config: true } },
      isTest: true,
    },
  });
  if (!delivery || delivery.workspace.archivedAt || delivery.status === "CANCELLED" || delivery.status === "FAILED") return false;
  if (delivery.destinationId) {
    const destination = delivery.destination;
    if (!destination || destination.workspaceId !== delivery.workspaceId || (!destination.enabled && !delivery.isTest)) return false;
    if (recipientEmail === undefined) return true;
    if (destination.kind !== "EMAIL") return false;
    // A current explicit `to` address remains intentional even if it overlaps a
    // revoked member. Selector-only addresses must still resolve right now.
    return mayReceiveDestinationEmail(delivery.workspaceId, destination.config, recipientEmail);
  }
  if (!delivery.userId) return false;
  return mayReceive(delivery.workspaceId, delivery.userId, delivery.event.type, recipientEmail);
}

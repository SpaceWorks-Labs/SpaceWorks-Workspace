import "server-only";
import type { MessagingConnection } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { InboundMessage } from "./inbound";
import { publish } from "@/lib/realtime";
import { sendTransport } from "./transport";
export async function bridgeInbound(connection: MessagingConnection, message: InboundMessage) {
  const bridge = await prisma.bridgedChannel.findFirst({ where: { workspaceId: connection.workspaceId, connectionId: connection.id, externalChannelId: message.channelId, enabled: true, direction: { in: ["INBOUND", "BOTH"] }, workspaceChannel: { workspaceId: connection.workspaceId, kind: "PUBLIC", teamId: null, archivedAt: null } } });
  if (!bridge || message.bot || message.userId === connection.botExternalId || !message.messageId || !message.text || message.private) return false;
  const identity = await prisma.externalIdentityLink.findFirst({ where: { workspaceId: connection.workspaceId, connectionId: connection.id, externalUserId: message.userId, user: { disabledAt: null, memberships: { some: { workspaceId: connection.workspaceId, status: "ACTIVE" } } } } });
  const row = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "BridgedChannel" WHERE id = ${bridge.id} AND "workspaceId" = ${connection.workspaceId} FOR UPDATE`;
    if (await tx.bridgedMessage.findFirst({ where: { bridgedChannelId: bridge.id, externalMessageId: message.messageId, bridge: { workspaceId: connection.workspaceId } } })) return null;
    const created = await tx.message.create({ data: { workspaceId: connection.workspaceId, channelId: bridge.workspaceChannelId, authorId: identity?.userId ?? null, authorKind: identity ? "USER" : "SYSTEM", body: identity ? message.text : `[${connection.label} member] ${message.text}`, origin: `bridge:${bridge.id}` } });
    await tx.bridgedMessage.create({ data: { bridgedChannelId: bridge.id, workspaceMessageId: created.id, externalMessageId: message.messageId, originSide: "EXTERNAL" } });
    return created;
  });
  if (row) await publish(connection.workspaceId, `channel:${bridge.workspaceChannelId}`, { type: "message.created", data: { messageId: row.id, channelId: bridge.workspaceChannelId } });
  return true;
}
export async function bridgeOutbound() {
  const bridges = await prisma.bridgedChannel.findMany({ where: { enabled: true, direction: { in: ["OUTBOUND", "BOTH"] }, connection: { status: "ACTIVE", lastVerifiedAt: { not: null }, workspace: { status: "ACTIVE", archivedAt: null } }, workspaceChannel: { kind: "PUBLIC", teamId: null, archivedAt: null } }, include: { connection: true }, take: 100 });
  for (const bridge of bridges) {
    const messages = await prisma.message.findMany({ where: { workspaceId: bridge.workspaceId, channelId: bridge.workspaceChannelId, origin: null, deletedAt: null, createdAt: { gte: bridge.createdAt }, bridged: { none: { bridgedChannelId: bridge.id } } }, include: { author: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 20 });
    for (const message of messages) {
      // Keep a database lock across the send so replicas do not send the same row concurrently.
      // A provider success followed by process death can still repeat once (at-least-once transport).
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "BridgedChannel" WHERE id = ${bridge.id} AND "workspaceId" = ${bridge.workspaceId} FOR UPDATE`;
        if (await tx.bridgedMessage.findFirst({ where: { bridgedChannelId: bridge.id, workspaceMessageId: message.id, bridge: { workspaceId: bridge.workspaceId } } })) return;
        const sent = await sendTransport(bridge.connection, bridge.externalChannelId, `${message.author?.name ?? "Former member"}: ${message.body}`);
        if (!sent.ok) return;
        await tx.bridgedMessage.create({ data: { bridgedChannelId: bridge.id, workspaceMessageId: message.id, externalMessageId: sent.providerMessageId ?? `workspace:${message.id}`, originSide: "WORKSPACE" } });
      }, { timeout: 20000 });
    }
  }
}

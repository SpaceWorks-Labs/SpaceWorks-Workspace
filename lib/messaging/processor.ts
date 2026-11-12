import "server-only";
import type { MessagingConnection, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { requestJson } from "@/lib/integrations/http";
import { runMessagingAssistant } from "@/lib/integrations/assistant";
import { redeemLinkHash } from "./linking";
import { bridgeInbound } from "./bridging";
import { sendTransport } from "./transport";
import { openCredentials } from "./credentials";
import { openSlackDm } from "./api/slack";
import { openMattermostDm } from "./api/mattermost";
import { truncate } from "./format/escape";
import type { InboundMessage } from "./inbound";

async function reply(connection: MessagingConnection, message: InboundMessage, text: string, personal = false) {
  if (message.interaction) {
    const token = decryptSecret("messaging-credentials", message.interaction.tokenEnc);
    const result = await requestJson(`https://discord.com/api/v10/webhooks/${encodeURIComponent(message.interaction.applicationId)}/${encodeURIComponent(token)}/messages/@original`, { method: "PATCH", body: { content: truncate(text, 2000), allowed_mentions: { parse: [] } }, label: "Discord" });
    if (!result.ok) throw new Error("Reply failed. The provider will be retried.");
    return;
  }
  let channelId = message.channelId;
  if (personal && !message.private) {
    if (connection.provider === "SLACK") {
      const credentials = openCredentials({ ...connection, provider: "SLACK" });
      if (!credentials) throw new Error("Connection credentials unavailable.");
      const dm = await openSlackDm(credentials.botToken, message.userId);
      if (!dm.ok) throw new Error("Could not open a private reply.");
      channelId = dm.data.channel.id;
    } else if (connection.provider === "MATTERMOST") {
      const credentials = openCredentials({ ...connection, provider: "MATTERMOST" });
      const config = connection.config as { serverUrl?: string };
      if (!credentials || !config.serverUrl || !connection.botExternalId) throw new Error("Connection credentials unavailable.");
      const dm = await openMattermostDm(config.serverUrl, credentials.botToken, connection.botExternalId, message.userId);
      if (!dm.ok) throw new Error("Could not open a private reply.");
      channelId = dm.data.id;
    } else if (connection.provider === "TELEGRAM") channelId = message.userId;
    else return;
  }
  const sent = await sendTransport(connection, channelId, text);
  if (!sent.ok) throw new Error("Reply failed. The provider will be retried.");
}

export async function processInboundMessage(connection: MessagingConnection, message: InboundMessage) {
  if (message.bot || message.userId === connection.botExternalId) return;
  if (message.codeHash) {
    if (!message.private && !message.interaction && !["SLACK", "MATTERMOST"].includes(connection.provider)) return;
    const ok = await redeemLinkHash(connection, message.codeHash, message.userId, message.private ? message.channelId : null);
    await reply(connection, message, ok ? "Your Space Works account is linked. You can ask the assistant here." : "This code could not be used. Create a fresh code in Connected accounts.", true);
    return;
  }
  if (/^\/?(?:sw\s+)?unlink(?:@\w+)?\s*$/i.test(message.text)) {
    await prisma.externalIdentityLink.deleteMany({ where: { workspaceId: connection.workspaceId, connectionId: connection.id, externalUserId: message.userId } });
    await reply(connection, message, "Your Space Works account is unlinked.", true);
    return;
  }
  const botName = (connection.config as { botUsername?: string }).botUsername;
  const addressed = message.private || message.mention || Boolean(botName && message.text.toLowerCase().includes(`@${botName.toLowerCase()}`));
  if (!addressed) { const bridged = await bridgeInbound(connection, message); if (message.interaction) await reply(connection, message, bridged ? "Message shared with the Space Works channel." : "This channel has no incoming Space Works bridge. Ask an admin to add one."); return; }
  const identity = await prisma.externalIdentityLink.findFirst({ where: { workspaceId: connection.workspaceId, connectionId: connection.id, externalUserId: message.userId, user: { disabledAt: null, memberships: { some: { workspaceId: connection.workspaceId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MEMBER"] } } } } } });
  if (!identity) { await reply(connection, message, "Link your account first. Open Notifications → Connected accounts in Space Works.", true); return; }
  // Assistant answers always go privately; a user's private context must not reach a shared channel.
  const externalKey = `${message.channelId}:${identity.userId}`;
  const conversation = await prisma.messagingConversation.findUnique({ where: { connectionId_externalKey_userId: { connectionId: connection.id, externalKey, userId: identity.userId } } });
  const text = message.text.replace(/^\/?(?:sw\s+)?ask(?:@\w+)?\s*/i, "").replace(/<@[^>]+>/g, "").trim();
  if (!text) return;
  const result = await runMessagingAssistant({ workspaceId: connection.workspaceId, userId: identity.userId, text, conversationId: conversation?.assistantConversationId });
  if (result.conversationId) await prisma.messagingConversation.upsert({ where: { connectionId_externalKey_userId: { connectionId: connection.id, externalKey, userId: identity.userId } }, create: { connectionId: connection.id, externalKey, userId: identity.userId, assistantConversationId: result.conversationId }, update: { assistantConversationId: result.conversationId, lastMessageAt: new Date() } });
  await reply(connection, message, result.text, true);
}

/** Durable inbound queue, drained by the outbox scheduler. A lease allows recovery after a crash. */
export async function processInboundBatch(now = new Date()) {
  const available = { status: { in: ["RECEIVED", "FAILED"] as ("RECEIVED" | "FAILED")[] }, OR: [{ processedAt: null }, { processedAt: { lt: new Date(now.getTime() - 300000) } }] };
  const rows = await prisma.inboundEvent.findMany({ where: { ...available, connection: { status: "ACTIVE", lastVerifiedAt: { not: null }, workspace: { status: "ACTIVE", archivedAt: null } } }, include: { connection: true }, orderBy: { receivedAt: "asc" }, take: 25 });
  for (const row of rows) {
    const payload = row.payload as unknown as InboundMessage & { attempts?: number };
    const attempts = (payload.attempts ?? 0) + 1;
    const claim = await prisma.inboundEvent.updateMany({ where: { id: row.id, connectionId: row.connectionId, ...available }, data: { processedAt: now, payload: { ...payload, attempts } as unknown as Prisma.InputJsonValue } });
    if (!claim.count) continue;
    try {
      await processInboundMessage(row.connection, payload);
      await prisma.inboundEvent.updateMany({ where: { id: row.id, connectionId: row.connectionId }, data: { status: "PROCESSED", processedAt: new Date(), error: null } });
    } catch {
      await prisma.inboundEvent.updateMany({ where: { id: row.id, connectionId: row.connectionId }, data: { status: attempts >= 6 ? "IGNORED" : "FAILED", error: attempts >= 6 ? "Processing stopped after six attempts. Check the connection." : "Processing failed. Retrying after five minutes." } });
    }
  }
}

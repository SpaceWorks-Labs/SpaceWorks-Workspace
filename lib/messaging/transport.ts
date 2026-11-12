import "server-only";
import type { MessagingConnection } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DESTINATION_ADAPTERS } from "@/lib/notify/adapters";
import type { AdapterSendInput } from "@/lib/notify/adapters/types";
export async function sendTransport(connection: MessagingConnection, channelId: string, text: string) {
  const workspace = await prisma.workspace.findFirst({ where: { id: connection.workspaceId, status: "ACTIVE", archivedAt: null }, select: { id: true, name: true, slug: true } });
  if (!workspace) return { ok: false, retryable: false, error: "Workspace unavailable." } as const;
  const kind = connection.provider;
  const config = kind === "TELEGRAM" ? { chatId: channelId } : kind === "WHATSAPP" ? { to: `+${channelId.replace(/\D/g, "")}` } : { mode: "bot", channelId };
  const input: AdapterSendInput = { deliveryId: "transport", event: { id: "transport", type: "message.dm" }, isTest: false, thread: null, message: { title: "Space Works", text, url: null, severity: "info", severityLabel: "Info", fields: [], actions: [], eventType: "message.dm", workspace }, target: { type: "destination", destination: { id: "transport", name: "Messaging", kind, connection, config, secretEnc: null } } };
  return DESTINATION_ADAPTERS[kind].send(input);
}

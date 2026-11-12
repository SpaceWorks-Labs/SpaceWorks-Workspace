import "server-only";
import type { MessagingProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { openCredentials } from "./credentials";
import { verifySlack, verifyDiscord, verifySha256, verifyToken } from "./signatures";
import { encryptSecret, sha256Hex } from "@/lib/crypto";
export type InboundMessage = { eventId: string; userId: string; channelId: string; messageId: string; text: string; private: boolean; mention: boolean; bot: boolean; codeHash?: string; interaction?: { applicationId: string; tokenEnc: string } };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown) => typeof v === "string" || typeof v === "number" ? String(v) : "";
export function normalizeInbound(provider: MessagingProvider, raw: unknown): InboundMessage[] {
  const p = obj(raw); const event = obj(p.event); const data = obj(p.data);
  if (provider === "SLACK") {
    const e = p.event ? event : p;
    if (p.event && !["message", "app_mention"].includes(str(e.type))) return [];
    return [{ eventId: str(p.event_id ?? p.trigger_id) || sha256Hex(JSON.stringify(p)), userId: str(e.user ?? e.user_id), channelId: str(e.channel ?? e.channel_id), messageId: str(e.ts ?? p.trigger_id), text: str(e.text), private: e.channel_type === "im" || str(e.channel ?? e.channel_id).startsWith("D"), mention: e.type === "app_mention" || Boolean(p.command), bot: Boolean(e.bot_id || e.subtype) }];
  }
  if (provider === "DISCORD") {
    if (p.type !== 2) return [];
    const member = obj(p.member); const user = obj(member.user ?? p.user); const options = Array.isArray(data.options) ? data.options.map(obj) : [];
    const name = str(data.name); const value = str(options[0]?.value);
    return [{ eventId: str(p.id), userId: str(user.id), channelId: str(p.channel_id), messageId: str(p.id), text: ["ask", "post"].includes(name) ? value : `${name} ${value}`.trim(), private: !p.guild_id, mention: name !== "post", bot: Boolean(user.bot), interaction: { applicationId: str(p.application_id), tokenEnc: encryptSecret("messaging-credentials", str(p.token)) } }];
  }
  if (provider === "TELEGRAM") {
    const m = obj(p.message ?? p.channel_post); const from = obj(m.from ?? m.sender_chat); const chat = obj(m.chat); const text = str(m.text);
    return m.message_id ? [{ eventId: str(p.update_id), userId: str(from.id ?? chat.id), channelId: str(chat.id), messageId: str(m.message_id), text, private: chat.type === "private", mention: /^\/(ask|link|unlink)(@\w+)?\b/.test(text), bot: Boolean(from.is_bot) }] : [];
  }
  if (provider === "MATTERMOST") return [{ eventId: str(p.post_id ?? p.trigger_id) || sha256Hex(JSON.stringify(p)), userId: str(p.user_id), channelId: str(p.channel_id), messageId: str(p.post_id), text: str(p.text), private: p.channel_type === "D", mention: Boolean(p.command || p.trigger_word), bot: p.bot === true }];
  const messages: InboundMessage[] = [];
  for (const entry of Array.isArray(p.entry) ? p.entry : []) for (const change of Array.isArray(obj(entry).changes) ? obj(entry).changes as unknown[] : []) {
    const value = obj(obj(change).value);
    for (const item of Array.isArray(value.messages) ? value.messages : []) {
      const m = obj(item); if (m.type !== "text") continue;
      messages.push({ eventId: str(m.id), userId: str(m.from), channelId: str(m.from), messageId: str(m.id), text: str(obj(m.text).body), private: true, mention: false, bot: false });
    }
  }
  return messages;
}
export async function readInboundBody(request: Request, max = 262144) {
  if (Number(request.headers.get("content-length")) > max) throw new Error("Request too large.");
  const reader = request.body?.getReader(); if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) throw new Error("Request too large."); chunks.push(value); } } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function inboundRequest(request: Request, providerSegment: string, connectionId: string) {
  const provider = providerSegment.toUpperCase();
  if (!["SLACK", "DISCORD", "MATTERMOST", "TELEGRAM", "WHATSAPP"].includes(provider)) return new Response(null, { status: 404 });
  const connection = await prisma.messagingConnection.findFirst({ where: { id: connectionId, provider: provider as MessagingProvider, status: { not: "DISABLED" }, workspace: { status: "ACTIVE", archivedAt: null } } });
  if (!connection) return new Response(null, { status: 404 });
  if (request.method === "GET" && connection.provider === "WHATSAPP") {
    const credentials = openCredentials({ ...connection, provider: "WHATSAPP" }); const url = new URL(request.url);
    if (url.searchParams.get("hub.mode") !== "subscribe" || !verifyToken(credentials?.verifyToken, url.searchParams.get("hub.verify_token"))) return new Response(null, { status: 403 });
    return new Response(url.searchParams.get("hub.challenge") ?? "");
  }
  if (request.method !== "POST") return new Response(null, { status: 405 });
  let body: string; try { body = await readInboundBody(request); } catch { return new Response(null, { status: 413 }); }
  let raw: Record<string, unknown>;
  try { raw = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(body)) : obj(JSON.parse(body)); } catch { return new Response(null, { status: 400 }); }
  const headers = request.headers; let valid = false;
  const config = obj(connection.config);
  switch (connection.provider) {
    case "SLACK": { const c = openCredentials({ ...connection, provider: "SLACK" }); valid = Boolean(c && verifySlack(c.signingSecret, body, headers.get("x-slack-request-timestamp"), headers.get("x-slack-signature"))); if (config.teamId && (raw.team_id ?? raw.team) && (raw.team_id ?? obj(raw.team).id) !== config.teamId) valid = false; break; }
    case "DISCORD": valid = verifyDiscord(str(config.publicKey), body, headers.get("x-signature-timestamp"), headers.get("x-signature-ed25519")); if (raw.application_id && config.applicationId && raw.application_id !== config.applicationId) valid = false; if (config.guildId && raw.guild_id && raw.guild_id !== config.guildId) valid = false; break;
    case "TELEGRAM": { const c = openCredentials({ ...connection, provider: "TELEGRAM" }); valid = verifyToken(c?.webhookSecret, headers.get("x-telegram-bot-api-secret-token")); break; }
    case "WHATSAPP": { const c = openCredentials({ ...connection, provider: "WHATSAPP" }); valid = Boolean(c && verifySha256(c.appSecret, body, headers.get("x-hub-signature-256"))); const entries = Array.isArray(raw.entry) ? raw.entry : []; for (const e of entries) for (const change of Array.isArray(obj(e).changes) ? obj(e).changes as unknown[] : []) if (obj(obj(obj(change).value).metadata).phone_number_id !== config.phoneNumberId) valid = false; break; }
    case "MATTERMOST": { const c = openCredentials({ ...connection, provider: "MATTERMOST" }); valid = verifyToken(raw.command ? c?.commandToken : c?.outgoingToken, str(raw.token)); break; }
  }
  if (!valid) return new Response(null, { status: 401 });
  if (connection.provider === "SLACK" && raw.type === "url_verification") return Response.json({ challenge: raw.challenge });
  if (connection.provider === "DISCORD" && raw.type === 1) return Response.json({ type: 1 });
  if (connection.status !== "ACTIVE" || !connection.lastVerifiedAt) return new Response(null, { status: 403 });
  for (const message of normalizeInbound(connection.provider, raw)) {
    if (!message.eventId || !message.userId || message.bot || message.userId === connection.botExternalId || message.text.length > 16000) continue;
    const link = message.text.match(/^\/?(?:sw\s+)?link(?:@\w+)?\s+(\S+)\s*$/i);
    if (link) { message.codeHash = sha256Hex(link[1]!); message.text = "link"; }
    await prisma.inboundEvent.createMany({ data: [{ provider: connection.provider, connectionId: connection.id, externalEventId: message.eventId, kind: connection.provider === "WHATSAPP" ? `whatsapp:${message.userId}` : "message", payload: message as unknown as Prisma.InputJsonValue }], skipDuplicates: true });
  }
  return connection.provider === "DISCORD" && raw.type === 2 ? Response.json({ type: 5, data: { flags: 64 } }) : Response.json({ ok: true });
}

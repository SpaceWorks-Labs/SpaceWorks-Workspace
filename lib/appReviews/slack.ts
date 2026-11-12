import "server-only";
import { z } from "zod";
import type { AppReviewSlackConfig } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { requestJson } from "./stores/http";
import { StoreError, safeStoreError } from "./stores/types";
import { escapeSlackText, normaliseSlackText, verifySlackSignature } from "./slackSecurity";
import { reviewUrl } from "./events";
import { sendReviewReply } from "./replies";

const tsSchema = z.string().regex(/^\d{1,15}\.\d{1,10}$/);
const reactionSchema = z.object({ type: z.literal("event_callback"), team_id: z.string().max(100), event_id: z.string().min(1).max(200), event: z.object({ type: z.literal("reaction_added"), reaction: z.string(), user: z.string().max(100), item_user: z.string().max(100).optional(), item: z.object({ type: z.literal("message"), channel: z.string().max(100).regex(/^[CG][A-Z0-9]+$/), ts: tsSchema }) }) });
async function slackCall<T extends { ok: boolean }>(config: AppReviewSlackConfig, method: "chat.postMessage" | "conversations.replies", data: Record<string, unknown>): Promise<T> {
  const headers = { Authorization: `Bearer ${decryptSecret("app-review-slack-token", config.botTokenEnc)}`, "Content-Type": "application/json; charset=utf-8" };
  const query = new URLSearchParams(Object.entries(data).map(([k, v]) => [k, String(v)]));
  const result = await requestJson<T>(`https://slack.com/api/${method}${method === "conversations.replies" ? `?${query}` : ""}`, { method: method === "conversations.replies" ? "GET" : "POST", headers, ...(method === "chat.postMessage" ? { body: JSON.stringify({ ...data, text: escapeSlackText(String(data.text ?? "")), unfurl_links: false, unfurl_media: false, parse: "none", mrkdwn: false }) } : {}) });
  if (!result.ok) throw new StoreError("STORE", "Slack couldn't complete this request. Check the app scopes and channel access.");
  return result;
}
/** Returns quickly after a durable INSERT. Never calls a store in the request path. */
export async function receiveSlackEvent(slug: string, raw: string, timestamp: string | null, signature: string | null, now = new Date()): Promise<Response> {
  const workspace = await prisma.workspace.findFirst({ where: { slug, status: "ACTIVE", archivedAt: null }, select: { id: true } });
  const config = workspace ? await prisma.appReviewSlackConfig.findUnique({ where: { workspaceId: workspace.id } }) : null;
  if (!config?.active || !verifySlackSignature(decryptSecret("app-review-slack-signing", config.signingSecretEnc), raw, timestamp, signature, now)) return Response.json({ error: "Request not verified." }, { status: 401 });
  let payload: unknown; try { payload = JSON.parse(raw); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const challenge = z.object({ type: z.literal("url_verification"), challenge: z.string().max(1000) }).safeParse(payload);
  if (challenge.success) return Response.json({ challenge: challenge.data.challenge });
  const parsed = reactionSchema.safeParse(payload); if (!parsed.success) return Response.json({ ok: true });
  const { event, event_id, team_id } = parsed.data;
  if (team_id !== config.teamId || event.reaction !== config.replyTriggerEmoji || event.user === config.botUserId || (event.item_user && event.item_user !== event.user)) return Response.json({ ok: true });
  await prisma.appReviewSlackEvent.createMany({ data: [{ workspaceId: config.workspaceId, externalEventId: event_id, channelId: event.item.channel, messageTs: event.item.ts, userId: event.user }], skipDuplicates: true });
  return Response.json({ ok: true });
}
/** Claim the permanent marker before POST. Ambiguous failures are never auto-posted again. */
export async function mirrorReview(workspaceId: string, reviewId: string) {
  const review = await prisma.appReview.findFirst({ where: { workspaceId, id: reviewId, slackPostStatus: "NONE", app: { active: true, account: { active: true } }, workspace: { status: "ACTIVE", archivedAt: null } }, include: { app: { select: { name: true, slackChannelId: true } }, workspace: { select: { slug: true } } } });
  if (!review?.app.slackChannelId) return;
  const config = await prisma.appReviewSlackConfig.findUnique({ where: { workspaceId } }); if (!config?.active) return;
  const channel = review.app.slackChannelId;
  const claim = await prisma.appReview.updateMany({ where: { workspaceId, id: reviewId, slackPostStatus: "NONE", slackPostAttemptAt: null }, data: { slackPostStatus: "POSTING", slackPostAttemptAt: new Date(), slackChannelId: channel } });
  if (!claim.count) return;
  try {
    const link = new URL(reviewUrl(review.workspace.slug, review.id), process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3230").toString();
    const result = await slackCall<{ ok: boolean; ts?: string }>(config, "chat.postMessage", {
      channel, text: `${review.app.name} — ${review.rating} out of 5\n${review.title}\n${review.body.slice(0, 2500)}\n${link}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: `${review.app.name} — ${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)} (${review.rating} out of 5)`.slice(0, 150), emoji: false } },
        { type: "section", text: { type: "plain_text", text: `${review.author} · ${review.platform === "APPLE" ? "App Store" : "Google Play"}\n${review.title}\n${review.body}`.slice(0, 2900), emoji: false } },
        { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open review", emoji: false }, url: link, action_id: "open_review" }] },
      ],
    });
    if (!result.ts || !tsSchema.safeParse(result.ts).success) throw new StoreError("INVALID", "Slack didn't return a message reference.");
    await prisma.appReview.updateMany({ where: { workspaceId, id: reviewId, slackPostStatus: "POSTING" }, data: { slackMessageTs: result.ts, slackPostStatus: "POSTED" } });
  } catch { await prisma.appReview.updateMany({ where: { workspaceId, id: reviewId, slackPostStatus: "POSTING" }, data: { slackPostStatus: "FAILED" } }); }
}
type SlackMessage = { ts: string; text?: string; user?: string; thread_ts?: string; bot_id?: string; subtype?: string };
export async function processSlackEvent(workspaceId: string, eventId: string) {
  const claim = await prisma.appReviewSlackEvent.updateMany({ where: { workspaceId, id: eventId, status: "QUEUED" }, data: { status: "PROCESSING", processedAt: new Date() } });
  if (!claim.count) return;
  const event = await prisma.appReviewSlackEvent.findFirstOrThrow({ where: { workspaceId, id: eventId } });
  const finish = (status: string, error?: string) => prisma.appReviewSlackEvent.updateMany({ where: { workspaceId, id: eventId }, data: { status, processedAt: new Date(), error: error ?? null } });
  let root: string | undefined;
  const config = await prisma.appReviewSlackConfig.findUnique({ where: { workspaceId } });
  if (!config?.active) { await finish("IGNORED"); return; }
  try {
    const mapping = await prisma.appReviewSlackMember.findUnique({ where: { workspaceId_slackUserId: { workspaceId, slackUserId: event.userId } } });
    const member = mapping ? await prisma.membership.findFirst({ where: { workspaceId, userId: mapping.userId, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null }, workspace: { status: "ACTIVE", archivedAt: null } }, select: { userId: true } }) : null;
    if (!member) { await finish("IGNORED", "Map this Slack account to an active workspace member in App reviews settings."); return; }
    // Restrict reads to channels that actually contain a posted review in this tenant.
    if (!await prisma.appReview.findFirst({ where: { workspaceId, slackChannelId: event.channelId, slackPostStatus: "POSTED" }, select: { id: true } })) { await finish("IGNORED"); return; }
    const result = await slackCall<{ ok: boolean; messages?: SlackMessage[] }>(config, "conversations.replies", { channel: event.channelId, ts: event.messageTs, oldest: event.messageTs, latest: event.messageTs, inclusive: true, limit: 15 });
    const message = result.messages?.find(m => m.ts === event.messageTs);
    if (!message || message.user !== event.userId || message.bot_id || message.subtype || !message.thread_ts || message.thread_ts === message.ts || !message.text) { await finish("IGNORED"); return; }
    root = message.thread_ts;
    const review = await prisma.appReview.findFirst({ where: { workspaceId, slackChannelId: event.channelId, slackMessageTs: root, slackPostStatus: "POSTED" }, select: { id: true } });
    if (!review) { await finish("IGNORED"); return; }
    const outcome = await sendReviewReply({ workspaceId, reviewId: review.id, actorId: member.userId, source: "SLACK", triggerKey: `slack:${event.channelId}:${event.messageTs}`, body: normaliseSlackText(message.text) });
    // Persist outcome before confirmation; retrying a delivered event cannot confirm twice.
    await finish(outcome.ok ? "DONE" : "FAILED", outcome.ok ? undefined : outcome.error);
    if (outcome.ok && outcome.data?.duplicate) return;
    const text = outcome.ok ? outcome.data?.state === "PUBLISHED" ? "Reply published" : outcome.data?.state === "PENDING" ? "Sent, waiting for Apple to publish" : "Sent. Check the publish state in App reviews." : `Couldn't send: ${outcome.error}`;
    await slackCall(config, "chat.postMessage", { channel: event.channelId, thread_ts: root, text, blocks: [{ type: "section", text: { type: "plain_text", text, emoji: false } }] });
  } catch (error) {
    await finish("FAILED", safeStoreError(error));
    if (root) { try { await slackCall(config, "chat.postMessage", { channel: event.channelId, thread_ts: root, text: `Couldn't send: ${safeStoreError(error)}` }); } catch { /* Never retry a store send to recover a Slack confirmation. */ } }
  }
}

import "server-only";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { prisma } from "@/lib/db";
import { pollApp } from "@/lib/appReviews/ingest";
import { recheckReply } from "@/lib/appReviews/replies";
import { mirrorReview, processSlackEvent } from "@/lib/appReviews/slack";

export async function run(now = new Date()) {
  const off = await workspacesWithoutModule("social");
  // Recover interrupted queue work; the reply trigger claim is permanent.
  const staleBefore = new Date(now.getTime() - 300_000);
  const interrupted = await prisma.appReviewSlackEvent.findMany({ where: { status: "PROCESSING", processedAt: { lt: staleBefore }, workspace: { status: "ACTIVE", archivedAt: null }, workspaceId: { notIn: off } }, select: { workspaceId: true, id: true }, take: 100 });
  for (const e of interrupted) await prisma.appReviewSlackEvent.updateMany({ where: { workspaceId: e.workspaceId, id: e.id, status: "PROCESSING", processedAt: { lt: staleBefore } }, data: { status: "QUEUED" } });
  const events = await prisma.appReviewSlackEvent.findMany({ where: { status: "QUEUED", workspace: { status: "ACTIVE", archivedAt: null }, workspaceId: { notIn: off } }, select: { workspaceId: true, id: true }, orderBy: { createdAt: "asc" }, take: 30 });
  for (const e of events) await processSlackEvent(e.workspaceId, e.id);
  const apps = await prisma.reviewedApp.findMany({ where: { active: true, nextPollAt: { lte: now }, account: { active: true }, workspace: { status: "ACTIVE", archivedAt: null }, workspaceId: { notIn: off } }, select: { workspaceId: true, id: true }, orderBy: { nextPollAt: "asc" }, take: 50 });
  for (const app of apps) await pollApp(app.workspaceId, app.id, now);
  const mirrors = await prisma.appReview.findMany({ where: { slackPostStatus: "NONE", slackPostAttemptAt: null, app: { active: true, account: { active: true }, slackChannelId: { not: null } }, workspace: { status: "ACTIVE", archivedAt: null }, workspaceId: { notIn: off } }, select: { workspaceId: true, id: true }, orderBy: { createdAt: "asc" }, take: 50 });
  for (const r of mirrors) await mirrorReview(r.workspaceId, r.id);
  // A process crash after chat.postMessage must not cause a second post.
  const interruptedPosts = await prisma.appReview.findMany({ where: { slackPostStatus: "POSTING", slackPostAttemptAt: { lt: staleBefore }, workspace: { status: "ACTIVE", archivedAt: null }, workspaceId: { notIn: off } }, select: { workspaceId: true, id: true }, take: 100 });
  for (const r of interruptedPosts) await prisma.appReview.updateMany({ where: { workspaceId: r.workspaceId, id: r.id, slackPostStatus: "POSTING", slackPostAttemptAt: { lt: staleBefore } }, data: { slackPostStatus: "FAILED" } });
  const pending = await prisma.appReview.findMany({ where: { OR: [{ platform: "APPLE", replyStatus: "SENT", replyPublishState: { in: ["PENDING", "UNKNOWN"] } }, { replyStatus: { in: ["SENDING", "FAILED"] } }], app: { active: true, account: { active: true } }, workspace: { status: "ACTIVE", archivedAt: null }, workspaceId: { notIn: off } }, select: { workspaceId: true, id: true }, orderBy: { replyCheckedAt: { sort: "asc", nulls: "first" } }, take: 50 });
  for (const r of pending) await recheckReply(r.workspaceId, r.id, now);
}

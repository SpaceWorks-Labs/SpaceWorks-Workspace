import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { claimMessages, openMessageCount, recount, recoverStaleClaims, skipOpenMessages, STALE_LOCK_MS } from "@/lib/campaigns/send/claim";
import { buildContext } from "@/lib/campaigns/send/context";
import { capRemaining, finishCampaign, pauseRunning, promoteDue, sendingAllowed } from "@/lib/campaigns/send/lifecycle";
import { materialiseChunk } from "@/lib/campaigns/send/materialise";
import { processMessage } from "@/lib/campaigns/send/message";
import { takeSendTokens } from "@/lib/campaigns/send/rate";
import { loadSendSettings } from "@/lib/campaigns/send/settings";
import { createCampaignSender, SHARED_SMTP_RECIPIENT_LIMIT } from "@/lib/campaigns/transport";

const WORKER_ID = randomUUID();
const STREAK_KEY = Symbol.for("sww.campaigns.failureStreak");
type G = typeof globalThis & { [STREAK_KEY]?: Map<string, number> };
const streaks = () => ((globalThis as G)[STREAK_KEY] ??= new Map<string, number>());
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type RunOptions = { budgetMs?: number };

/** One scheduler tick: promote due campaigns, then work on every RUNNING campaign this worker can lock. */
export async function runCampaignSending(now = new Date(), options: RunOptions = {}): Promise<void> {
  const deadline = Date.now() + (options.budgetMs ?? 45_000);
  const disabled = await workspacesWithoutModule("campaigns");
  await promoteDue(now, disabled);
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
  const running = await prisma.campaign.findMany({
    where: { status: "RUNNING", workspaceId: { notIn: disabled }, OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] },
    orderBy: { startedAt: "asc" },
    take: 20,
    select: { id: true },
  });
  for (const { id } of running) {
    if (Date.now() >= deadline) break;
    await processCampaign(id, deadline);
  }
}

async function processCampaign(campaignId: string, deadline: number): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
  const locked = await prisma.campaign.updateMany({
    where: { id: campaignId, status: "RUNNING", OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] },
    data: { lockedAt: new Date(), lockedBy: WORKER_ID },
  });
  if (locked.count === 0) return;
  try {
    await sendLoop(campaignId, deadline);
  } finally {
    await prisma.campaign.updateMany({ where: { id: campaignId, lockedBy: WORKER_ID }, data: { lockedAt: null, lockedBy: null } });
  }
}

async function sendLoop(campaignId: string, deadline: number): Promise<void> {
  const row = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!row || row.status !== "RUNNING") return;
  // A suspended workspace or a disabled module stops sending without changing the campaign.
  if (!(await sendingAllowed(row.workspaceId))) return;
  const settings = await loadSendSettings(row.workspaceId);
  if (!settings.footerAddress) return void (await pauseRunning(row, "footer_missing"));
  const sender = await createCampaignSender(row.workspaceId);
  if (!sender) return void (await pauseRunning(row, "no_smtp"));
  await recoverStaleClaims(campaignId);
  const ctx = await buildContext(row, sender, settings);
  const streak = streaks();
  const maxTotal = sender.shared ? SHARED_SMTP_RECIPIENT_LIMIT : undefined;
  const cursor = { id: row.id, workspaceId: row.workspaceId, lastSubscriberId: row.lastSubscriberId };

  while (Date.now() < deadline) {
    const status = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
    if (status?.status === "CANCELLED") {
      await skipOpenMessages(campaignId);
      await recount(campaignId);
      return;
    }
    if (status?.status !== "RUNNING") return;
    await prisma.campaign.updateMany({ where: { id: campaignId, lockedBy: WORKER_ID }, data: { lockedAt: new Date() } });

    const scanned = await materialiseChunk(cursor, ctx.listIds, maxTotal === undefined ? {} : { maxTotal });
    const remaining = await capRemaining(row.workspaceId);
    if (remaining !== null && remaining <= 0) return void (await pauseRunning(row, "monthly_cap"));

    const want = Math.min(settings.batchSize, remaining ?? settings.batchSize);
    const granted = await takeSendTokens(row.workspaceId, settings.sendPerMinute, want);
    if (granted === 0) {
      await sleep(Math.min(2_000, Math.ceil(60_000 / settings.sendPerMinute)));
      continue;
    }
    const ids = await claimMessages(campaignId, granted);
    if (ids.length === 0) {
      if (scanned === 0 && (await openMessageCount(campaignId)) === 0) await finishCampaign(row);
      else if (scanned === 0) return; // only delayed retries or other workers' claims remain
      continue;
    }
    for (const id of ids) {
      const outcome = await processMessage(ctx, id);
      // A refused recipient proves the relay works, so it resets the failure streak like a send does.
      if (outcome === "sent" || outcome === "bounced") streak.delete(campaignId);
      else if (outcome === "failed" || outcome === "retry") {
        const count = (streak.get(campaignId) ?? 0) + 1;
        streak.set(campaignId, count);
        if (count > settings.maxErrors) {
          streak.delete(campaignId);
          await recount(campaignId);
          await pauseRunning(row, "max_errors", "Too many consecutive send failures.");
          return;
        }
      }
    }
    await recount(campaignId);
  }
}

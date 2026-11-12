import { prisma } from "@/lib/db";
import { auditCampaignEvent } from "@/lib/campaigns/audit";
import { dispatch } from "@/lib/notify";
import { describePausedReason } from "@/lib/campaigns/campaigns/state";
import { getEffectiveLimits } from "@/lib/limits";
import { workspaceUsage } from "@/lib/limits/usage";
import { getWorkspaceModules } from "@/lib/limits/modules";
import { isModuleEnabled } from "@/lib/modules";
import { loadSendSettings } from "@/lib/campaigns/send/settings";
import { recount } from "@/lib/campaigns/send/claim";

type Ref = { id: string; workspaceId: string; name: string; createdById: string | null };

async function safeDispatch(run: () => Promise<unknown>) {
  try {
    await run();
  } catch {
    console.error("[campaigns] notification failed");
  }
}

/** RUNNING to PAUSED (atomic), then notify. Returns false when someone else changed the status first. */
export async function pauseRunning(campaign: Ref, reason: string, lastError?: string): Promise<boolean> {
  const changed = await prisma.campaign.updateMany({
    where: { id: campaign.id, workspaceId: campaign.workspaceId, status: "RUNNING" },
    data: { status: "PAUSED", pausedReason: reason, lockedAt: null, lockedBy: null, ...(lastError ? { lastError } : {}) },
  });
  if (changed.count === 0) return false;
  await auditCampaignEvent({ action: "campaign_paused", workspaceId: campaign.workspaceId, targetType: "Campaign", targetId: campaign.id, metadata: { reason } });
  await safeDispatch(() =>
    dispatch(campaign.workspaceId, {
      type: "campaign.paused",
      title: `Campaign paused: ${campaign.name}`.slice(0, 150),
      body: describePausedReason(reason),
      recipients: campaign.createdById ? [campaign.createdById] : [],
      resource: { type: "Campaign", id: campaign.id },
      dedupeKey: `campaign.paused:${campaign.id}:${reason}`,
      data: { campaignId: campaign.id, reason },
    }),
  );
  return true;
}

/** RUNNING to FINISHED with exact counters, then notify the creator. */
export async function finishCampaign(campaign: Ref): Promise<boolean> {
  const counts = await recount(campaign.id);
  const changed = await prisma.campaign.updateMany({
    where: { id: campaign.id, workspaceId: campaign.workspaceId, status: "RUNNING" },
    data: { status: "FINISHED", finishedAt: new Date(), lockedAt: null, lockedBy: null },
  });
  if (changed.count === 0) return false;
  await auditCampaignEvent({ action: "campaign_finished", workspaceId: campaign.workspaceId, targetType: "Campaign", targetId: campaign.id, metadata: { sent: counts.sent, failed: counts.failed, skipped: counts.skipped } });
  await safeDispatch(() =>
    dispatch(campaign.workspaceId, {
      type: "campaign.finished",
      title: `Campaign finished: ${campaign.name}`.slice(0, 150),
      recipients: campaign.createdById ? [campaign.createdById] : [],
      resource: { type: "Campaign", id: campaign.id },
      dedupeKey: `campaign.finished:${campaign.id}`,
      data: { campaignId: campaign.id, ...counts },
    }),
  );
  return true;
}

/** Messages the monthly cap still allows (null means unlimited). */
export async function capRemaining(workspaceId: string, now = new Date()): Promise<number | null> {
  const limits = await getEffectiveLimits(workspaceId);
  if (limits.monthlyEmailCap === null) return null;
  const usage = await workspaceUsage(workspaceId, now);
  return Math.max(0, limits.monthlyEmailCap - usage.emailsThisMonth);
}

/** True when the workspace is ACTIVE and the campaigns module is on. */
export async function sendingAllowed(workspaceId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { status: true } });
  if (workspace?.status !== "ACTIVE") return false;
  return isModuleEnabled(await getWorkspaceModules(workspaceId), "campaigns");
}

/** Promote due SCHEDULED campaigns to RUNNING: atomic, snapshots the tracking flags, checks the cap. */
export async function promoteDue(now = new Date(), disabledWorkspaceIds: string[] = []): Promise<number> {
  const due = await prisma.campaign.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now }, workspaceId: { notIn: disabledWorkspaceIds } },
    orderBy: { scheduledAt: "asc" },
    take: 50,
    select: { id: true, workspaceId: true, name: true, createdById: true, trackOpens: true, trackClicks: true, individualTracking: true },
  });
  let promoted = 0;
  for (const campaign of due) {
    if (!(await sendingAllowed(campaign.workspaceId))) continue;
    const settings = await loadSendSettings(campaign.workspaceId);
    const started = await prisma.campaign.updateMany({
      where: { id: campaign.id, status: "SCHEDULED" },
      data: {
        status: "RUNNING",
        startedAt: now,
        pausedReason: null,
        trackOpens: campaign.trackOpens && settings.trackOpens,
        trackClicks: campaign.trackClicks && settings.trackClicks,
        individualTracking: campaign.individualTracking && settings.individualTracking,
      },
    });
    if (started.count === 0) continue;
    promoted += 1;
    await auditCampaignEvent({ action: "campaign_started", workspaceId: campaign.workspaceId, targetType: "Campaign", targetId: campaign.id });
    const remaining = await capRemaining(campaign.workspaceId, now);
    if (remaining !== null && remaining <= 0) await pauseRunning(campaign, "monthly_cap");
  }
  return promoted;
}

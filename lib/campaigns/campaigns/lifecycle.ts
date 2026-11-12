import "server-only";
import { prisma } from "@/lib/db";
import { auditCampaignEvent, type CampaignAuditAction } from "@/lib/campaigns/audit";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { skipOpenMessages, recount } from "@/lib/campaigns/send/claim";
import { capRemaining } from "@/lib/campaigns/send/lifecycle";
import { presendChecklist } from "@/lib/campaigns/campaigns/checks";
import { getCampaign, type Actor } from "@/lib/campaigns/campaigns/crud";
import { canApply } from "@/lib/campaigns/campaigns/state";

const audit = (actor: Actor, action: CampaignAuditAction, id: string, metadata?: Record<string, string | number | boolean | null>) =>
  auditCampaignEvent({ action, workspaceId: actor.workspaceId, actorId: actor.userId, targetType: "Campaign", targetId: id, metadata });

/** Schedule a draft (no date means send now). Blocking checklist items stop it. */
export async function scheduleCampaign(actor: Actor, id: string, scheduledAt: Date | null): Promise<ActionResult> {
  const campaign = await getCampaign(actor.workspaceId, id);
  if (!campaign) return actionError("That campaign no longer exists.");
  if (!canApply(campaign.status, "schedule")) return actionError("Only drafts can be scheduled.");
  if (!campaign.bodyHtml.trim() && !campaign.bodyText.trim()) return actionError("Add some content before sending.");
  const checklist = await presendChecklist(actor.workspaceId, campaign);
  const blocked = checklist.items.find((item) => item.blocking && !item.ok);
  if (blocked) return actionError(`${blocked.label} is required. ${blocked.detail ?? ""}`.trim());
  const when = scheduledAt && scheduledAt.getTime() > Date.now() ? scheduledAt : new Date();
  const res = await prisma.campaign.updateMany({ where: { id, workspaceId: actor.workspaceId, status: "DRAFT" }, data: { status: "SCHEDULED", scheduledAt: when, pausedReason: null } });
  if (res.count === 0) return actionError("Only drafts can be scheduled.");
  await audit(actor, "campaign_scheduled", id, { total: checklist.effectiveRecipients });
  return { ok: true };
}

export async function unscheduleCampaign(actor: Actor, id: string): Promise<ActionResult> {
  const res = await prisma.campaign.updateMany({ where: { id, workspaceId: actor.workspaceId, status: "SCHEDULED" }, data: { status: "DRAFT", scheduledAt: null } });
  return res.count ? { ok: true } : actionError("This campaign is not scheduled.");
}

export async function pauseCampaign(actor: Actor, id: string): Promise<ActionResult> {
  const res = await prisma.campaign.updateMany({ where: { id, workspaceId: actor.workspaceId, status: "RUNNING" }, data: { status: "PAUSED", pausedReason: "manual" } });
  if (!res.count) return actionError("Only a running campaign can be paused.");
  await audit(actor, "campaign_paused", id, { reason: "manual" });
  return { ok: true };
}

export async function resumeCampaign(actor: Actor, id: string): Promise<ActionResult> {
  const remaining = await capRemaining(actor.workspaceId);
  if (remaining !== null && remaining <= 0) return actionError("The monthly email cap is reached. Raise the cap or wait for next month.");
  const res = await prisma.campaign.updateMany({ where: { id, workspaceId: actor.workspaceId, status: "PAUSED" }, data: { status: "RUNNING", pausedReason: null } });
  return res.count ? { ok: true } : actionError("Only a paused campaign can be resumed.");
}

export async function cancelCampaign(actor: Actor, id: string): Promise<ActionResult> {
  const res = await prisma.campaign.updateMany({ where: { id, workspaceId: actor.workspaceId, status: { in: ["SCHEDULED", "RUNNING", "PAUSED"] } }, data: { status: "CANCELLED", pausedReason: null } });
  if (!res.count) return actionError("This campaign can no longer be cancelled.");
  await skipOpenMessages(id);
  await recount(id);
  await audit(actor, "campaign_cancelled", id);
  return { ok: true };
}

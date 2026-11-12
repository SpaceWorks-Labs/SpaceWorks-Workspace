import "server-only";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auditCampaignEvent } from "@/lib/campaigns/audit";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { canManageCampaigns } from "@/lib/campaigns/roles";
import { getCampaignSettings } from "@/lib/campaigns/settings";
import { buildBody } from "@/lib/campaigns/campaigns/content";
import { campaignSchema } from "@/lib/campaigns/campaigns/schemas";
import { canApply } from "@/lib/campaigns/campaigns/state";

export type Actor = { workspaceId: string; userId: string; role: WorkspaceRole; email: string };

export async function listCampaigns(workspaceId: string) {
  return prisma.campaign.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, name: true, subject: true, status: true, scheduledAt: true, startedAt: true, finishedAt: true, totalRecipients: true, sentCount: true, failedCount: true, pausedReason: true, createdAt: true },
  });
}

export async function getCampaign(workspaceId: string, id: string) {
  return prisma.campaign.findFirst({ where: { id, workspaceId }, include: { lists: { select: { listId: true } } } });
}

/** Lists and template must belong to the workspace (archived lists cannot be picked). */
async function validateRefs(workspaceId: string, listIds: string[], templateId: string | null): Promise<string | null> {
  if (listIds.length) {
    const found = await prisma.mailingList.count({ where: { workspaceId, id: { in: listIds }, archivedAt: null } });
    if (found !== new Set(listIds).size) return "Pick lists from this workspace.";
  }
  if (templateId && !(await prisma.emailTemplate.count({ where: { id: templateId, workspaceId } }))) return "Pick a template from this workspace.";
  return null;
}

async function prepare(actor: Actor, input: unknown, existingType?: string) {
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = parsed.data;
  if ((data.contentType === "HTML" || existingType === "HTML") && !canManageCampaigns(actor)) return actionError("Only admins can edit raw HTML campaigns.");
  const refError = await validateRefs(actor.workspaceId, [...new Set(data.listIds)], data.templateId);
  if (refError) return actionError(refError);
  const settings = await getCampaignSettings(actor.workspaceId);
  const trackOpens = data.trackOpens && settings.trackOpens;
  const trackClicks = data.trackClicks && settings.trackClicks;
  const fields = {
    name: data.name, subject: data.subject, fromName: data.fromName, replyTo: data.replyTo || null, contentType: data.contentType, bodySource: data.bodySource,
    ...buildBody(data.contentType, data.bodySource), templateId: data.templateId,
    trackOpens, trackClicks, individualTracking: data.individualTracking && settings.individualTracking && (trackOpens || trackClicks),
  } satisfies Prisma.CampaignUncheckedUpdateInput;
  return { fields, listIds: [...new Set(data.listIds)] };
}

export async function createCampaign(actor: Actor, input: unknown): Promise<ActionResult<{ id: string }>> {
  const prepared = await prepare(actor, input);
  if ("ok" in prepared) return prepared;
  const row = await prisma.campaign.create({
    data: { ...prepared.fields, workspaceId: actor.workspaceId, createdById: actor.userId, lists: { create: prepared.listIds.map((listId) => ({ listId })) } },
    select: { id: true },
  });
  await auditCampaignEvent({ action: "campaign_created", workspaceId: actor.workspaceId, actorId: actor.userId, targetType: "Campaign", targetId: row.id });
  return { ok: true, data: { id: row.id } };
}

export async function updateCampaign(actor: Actor, id: string, input: unknown): Promise<ActionResult> {
  const current = await getCampaign(actor.workspaceId, id);
  if (!current) return actionError("That campaign no longer exists.");
  if (!canApply(current.status, "edit")) return actionError("Only drafts can be edited. Unschedule or duplicate the campaign first.");
  const prepared = await prepare(actor, input, current.contentType);
  if ("ok" in prepared) return prepared;
  const changed = await prisma.$transaction(async (tx) => {
    const res = await tx.campaign.updateMany({ where: { id, workspaceId: actor.workspaceId, status: "DRAFT" }, data: prepared.fields });
    if (res.count === 0) return false;
    await tx.campaignList.deleteMany({ where: { campaignId: id } });
    await tx.campaignList.createMany({ data: prepared.listIds.map((listId) => ({ campaignId: id, listId })) });
    return true;
  });
  return changed ? { ok: true } : actionError("Only drafts can be edited.");
}

export async function deleteCampaign(actor: Actor, id: string): Promise<ActionResult> {
  const res = await prisma.campaign.deleteMany({ where: { id, workspaceId: actor.workspaceId, status: { in: ["DRAFT", "CANCELLED"] } } });
  if (res.count === 0) return actionError("Only drafts and cancelled campaigns can be deleted.");
  await auditCampaignEvent({ action: "campaign_deleted", workspaceId: actor.workspaceId, actorId: actor.userId, targetType: "Campaign", targetId: id });
  return { ok: true };
}

export async function duplicateCampaign(actor: Actor, id: string): Promise<ActionResult<{ id: string }>> {
  const src = await getCampaign(actor.workspaceId, id);
  if (!src) return actionError("That campaign no longer exists.");
  if (src.contentType === "HTML" && !canManageCampaigns(actor)) return actionError("Only admins can copy raw HTML campaigns.");
  const row = await prisma.campaign.create({
    data: {
      workspaceId: actor.workspaceId, createdById: actor.userId, name: `${src.name} (copy)`.slice(0, 120), subject: src.subject, fromName: src.fromName, replyTo: src.replyTo,
      contentType: src.contentType, bodySource: src.bodySource, bodyHtml: src.bodyHtml, bodyText: src.bodyText, templateId: src.templateId,
      trackOpens: src.trackOpens, trackClicks: src.trackClicks, individualTracking: src.individualTracking,
      lists: { create: src.lists.map((l) => ({ listId: l.listId })) },
    },
    select: { id: true },
  });
  return { ok: true, data: { id: row.id } };
}

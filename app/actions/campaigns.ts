"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { prisma } from "@/lib/db";
import { campaignContext, isFailure, parseId } from "@/lib/campaigns/campaigns/actionContext";
import { buildBody, renderPreviewHtml } from "@/lib/campaigns/campaigns/content";
import { cancelCampaign, createCampaign, deleteCampaign, duplicateCampaign, getCampaign, pauseCampaign, presendChecklist, resumeCampaign, scheduleCampaign, sendTestEmail, unscheduleCampaign, updateCampaign, type Checklist } from "@/lib/campaigns/campaigns";
import { getCampaignSettings } from "@/lib/campaigns/settings";
import { canSendCampaigns } from "@/lib/campaigns/roles";
import { NOT_ALLOWED } from "@/lib/actionResult";

const INVALID = "That campaign no longer exists.";

function refresh(slug: string) {
  revalidatePath(`/w/${slug}/campaigns`, "layout");
}

/** Create (id null) or update a draft. */
export async function saveCampaignAction(slug: string, id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await campaignContext(slug, "MEMBER");
  if (isFailure(ctx)) return ctx;
  let result: ActionResult<{ id: string }>;
  if (id === null) result = await createCampaign(ctx.actor, input);
  else {
    const campaignId = parseId(id);
    if (!campaignId) return actionError(INVALID);
    const updated = await updateCampaign(ctx.actor, campaignId, input);
    result = updated.ok ? { ok: true, data: { id: campaignId } } : updated;
  }
  if (result.ok) refresh(ctx.slug);
  return result;
}

export async function deleteCampaignAction(slug: string, id: string): Promise<ActionResult> {
  const ctx = await campaignContext(slug, "MEMBER");
  const campaignId = parseId(id);
  if (isFailure(ctx)) return ctx;
  if (!campaignId) return actionError(INVALID);
  const result = await deleteCampaign(ctx.actor, campaignId);
  if (result.ok) refresh(ctx.slug);
  return result;
}

export async function duplicateCampaignAction(slug: string, id: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await campaignContext(slug, "MEMBER");
  const campaignId = parseId(id);
  if (isFailure(ctx)) return ctx;
  if (!campaignId) return actionError(INVALID);
  const result = await duplicateCampaign(ctx.actor, campaignId);
  if (result.ok) refresh(ctx.slug);
  return result;
}

/** Rendered preview HTML for the sandboxed iframe. */
export async function previewCampaignAction(slug: string, input: { contentType: "RICHTEXT" | "MARKDOWN" | "HTML" | "PLAIN"; bodySource: string; templateId: string | null }): Promise<ActionResult<{ html: string }>> {
  const ctx = await campaignContext(slug, "MEMBER");
  if (isFailure(ctx)) return ctx;
  if (!["RICHTEXT", "MARKDOWN", "HTML", "PLAIN"].includes(input?.contentType) || typeof input.bodySource !== "string" || input.bodySource.length > 500_000) return actionError("Check the content and try again.");
  const [settings, workspace, template] = await Promise.all([
    getCampaignSettings(ctx.actor.workspaceId),
    prisma.workspace.findUniqueOrThrow({ where: { id: ctx.actor.workspaceId }, select: { name: true } }),
    input.templateId ? prisma.emailTemplate.findFirst({ where: { id: String(input.templateId), workspaceId: ctx.actor.workspaceId }, select: { bodyHtml: true } }) : null,
  ]);
  const body = buildBody(input.contentType, input.bodySource);
  const { html } = renderPreviewHtml({ ...body, templateHtml: template?.bodyHtml, footerAddress: settings.footerAddress ?? "", workspaceName: workspace.name });
  return { ok: true, data: { html } };
}

export async function sendTestAction(slug: string, id: string, input: unknown): Promise<ActionResult<{ sent: number }>> {
  const ctx = await campaignContext(slug, "MEMBER");
  const campaignId = parseId(id);
  if (isFailure(ctx)) return ctx;
  if (!campaignId) return actionError(INVALID);
  return sendTestEmail(ctx.actor, campaignId, input);
}

export async function checklistAction(slug: string, id: string): Promise<ActionResult<Checklist>> {
  const ctx = await campaignContext(slug, "MEMBER");
  const campaignId = parseId(id);
  if (isFailure(ctx)) return ctx;
  if (!campaignId) return actionError(INVALID);
  const campaign = await getCampaign(ctx.actor.workspaceId, campaignId);
  return campaign ? { ok: true, data: await presendChecklist(ctx.actor.workspaceId, campaign) } : actionError(INVALID);
}

type Operation = "schedule" | "unschedule" | "pause" | "resume" | "cancel";

/** Admin-only lifecycle changes. `scheduledAt` (ISO) applies to "schedule"; empty means send now. */
export async function campaignLifecycleAction(slug: string, id: string, operation: Operation, scheduledAt?: string | null): Promise<ActionResult> {
  const ctx = await campaignContext(slug, "MEMBER");
  const campaignId = parseId(id);
  if (isFailure(ctx)) return ctx;
  if (!canSendCampaigns({ role: ctx.actor.role })) return actionError(NOT_ALLOWED);
  if (!campaignId) return actionError(INVALID);
  let result: ActionResult;
  switch (operation) {
    case "schedule": {
      const when = scheduledAt ? new Date(scheduledAt) : null;
      if (when && Number.isNaN(when.getTime())) return actionError("Pick a valid date and time.");
      result = await scheduleCampaign(ctx.actor, campaignId, when);
      break;
    }
    case "unschedule": result = await unscheduleCampaign(ctx.actor, campaignId); break;
    case "pause": result = await pauseCampaign(ctx.actor, campaignId); break;
    case "resume": result = await resumeCampaign(ctx.actor, campaignId); break;
    case "cancel": result = await cancelCampaign(ctx.actor, campaignId); break;
    default: return actionError("That action is unavailable.");
  }
  if (result.ok) refresh(ctx.slug);
  return result;
}

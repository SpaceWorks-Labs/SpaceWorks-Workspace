"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { actionError, NOT_ALLOWED, type ActionResult } from "@/lib/actionResult";
import { campaignContext, isFailure, parseId } from "@/lib/campaigns/campaigns/actionContext";
import { deleteTemplate, saveTemplate } from "@/lib/campaigns/campaigns";
import { canManageCampaigns } from "@/lib/campaigns/roles";

export async function saveTemplateAction(slug: string, id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await campaignContext(slug, "MEMBER");
  if (isFailure(ctx)) return ctx;
  const templateId = id === null ? null : parseId(id);
  if (id !== null && !templateId) return actionError("That template no longer exists.");
  const result = await saveTemplate(ctx.actor, templateId, input);
  if (result.ok) revalidatePath(`/w/${ctx.slug}/campaigns`, "layout");
  return result;
}

export async function deleteTemplateAction(slug: string, id: string): Promise<ActionResult> {
  const ctx = await campaignContext(slug, "MEMBER");
  const templateId = parseId(id);
  if (isFailure(ctx)) return ctx;
  if (!canManageCampaigns({ role: ctx.actor.role })) return actionError(NOT_ALLOWED);
  if (!templateId) return actionError("That template no longer exists.");
  const result = await deleteTemplate(ctx.actor, templateId);
  if (result.ok) revalidatePath(`/w/${ctx.slug}/campaigns`, "layout");
  return result;
}

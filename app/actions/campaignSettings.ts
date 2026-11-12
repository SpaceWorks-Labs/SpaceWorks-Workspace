"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import type { ActionResult } from "@/lib/actionResult";
import { rotateBounceSecret, saveCampaignSettings } from "@/lib/campaigns/settings";
import { adminContext } from "@/lib/campaigns/actionContext";

export async function saveSettingsAction(slug: string, input: unknown): Promise<ActionResult> {
  const a = await adminContext(slug);
  if (a.error) return a.error;
  const result = await saveCampaignSettings(a.ctx.workspace.id, a.ctx.user.id, input);
  if (result.ok) revalidatePath(`/w/${slug}/campaigns/settings`);
  return result;
}

/** The new secret is returned once and is not stored in readable form. */
export async function rotateBounceSecretAction(slug: string): Promise<ActionResult<{ secret: string }>> {
  const a = await adminContext(slug);
  if (a.error) return a.error;
  const secret = await rotateBounceSecret(a.ctx.workspace.id, a.ctx.user.id);
  revalidatePath(`/w/${slug}/campaigns/settings`);
  return { ok: true, data: { secret } };
}

"use server";

import { z } from "zod";
import { revalidatePath } from "@/lib/frontend/cache";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { getWorkspaceForAction, getCurrentUser } from "@/lib/permissions";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { EMPTY_PUBLIC_CONFIG, type PublicObsConfig } from "@/lib/observability/config";
import { resolveWorkspacePublicConfig } from "@/lib/observability/resolve";
import { saveWorkspaceConnection } from "@/lib/observability/workspaceStore";
import { workspaceConnectionSchema } from "@/lib/observability/workspaceInput";

const slugSchema = z.string().min(1).max(64);

/** Save one provider's connection for the workspace. ADMIN only; Clarity needs an OWNER to turn it on. */
export async function saveWorkspaceAnalytics(slug: string, input: unknown): Promise<ActionResult> {
  const parsedSlug = slugSchema.safeParse(slug);
  const ctx = parsedSlug.success ? await getWorkspaceForAction(parsedSlug.data, "ADMIN", { module: "core" }) : null;
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = workspaceConnectionSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await saveWorkspaceConnection({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, role: ctx.membership.role, input: parsed.data });
  if (!result.ok) return actionError(result.error, result.field ? { [result.field]: [result.error] } : undefined);
  await recordAuditEvent({
    action: "workspace.analytics_updated",
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    targetType: "WorkspaceAnalyticsConnection",
    targetId: parsed.data.provider,
    metadata: { provider: parsed.data.provider, mode: result.mode, secretChanged: result.secretChanged },
  });
  revalidatePath(`/w/${ctx.workspace.slug}/settings/analytics`);
  return { ok: true };
}

/** Public client config for the workspace a user navigated to (membership checked server-side). */
export async function getObservabilityClientConfig(slug: string): Promise<PublicObsConfig> {
  const parsedSlug = slugSchema.safeParse(slug);
  const user = parsedSlug.success ? await getCurrentUser() : null;
  if (!parsedSlug.success || !user) return EMPTY_PUBLIC_CONFIG;
  try {
    return await resolveWorkspacePublicConfig(parsedSlug.data, user.id);
  } catch {
    return EMPTY_PUBLIC_CONFIG;
  }
}

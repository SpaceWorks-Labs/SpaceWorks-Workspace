import "server-only";
import { z } from "zod";
import type { WorkspaceRole } from "@prisma/client";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { getWorkspaceForAction } from "@/lib/permissions";
import { getWorkspaceModules } from "@/lib/limits/modules";
import { isModuleEnabled } from "@/lib/modules";
import type { Actor } from "@/lib/campaigns/campaigns/crud";

const slugSchema = z.string().min(1).max(64);
const idSchema = z.string().min(1).max(64);

/** Resolve the workspace and actor server-side: role, module switch and rate limit. */
export async function campaignContext(slug: unknown, minRole: WorkspaceRole): Promise<{ actor: Actor; slug: string } | ActionResult<never>> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return actionError(NOT_ALLOWED);
  const ctx = await getWorkspaceForAction(parsed.data, minRole);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (!isModuleEnabled(await getWorkspaceModules(ctx.workspace.id), "campaigns")) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  return { slug: ctx.workspace.slug, actor: { workspaceId: ctx.workspace.id, userId: ctx.user.id, role: ctx.membership.role, email: ctx.user.email ?? "" } };
}

export const isFailure = (value: { actor: Actor } | ActionResult<never>): value is ActionResult<never> => "ok" in value;

export function parseId(value: unknown): string | null {
  const parsed = idSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

import "server-only";

import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { getWorkspaceForAction, type WorkspaceContext } from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";

/**
 * Shared front half of every people/teams/rota/contacts Server Action:
 * resolve the workspace from the slug server-side (never a client-sent id),
 * then rate-limit. Capability checks, validation and writes happen in the
 * services, which take the returned context as their actor.
 */

const slugSchema = z.string().min(1).max(64);

export async function actionContext(slug: unknown, module: ModuleKey = "people"): Promise<WorkspaceContext | ActionResult<never>> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return actionError(NOT_ALLOWED);
  const ctx = await getWorkspaceForAction(parsed.data, "GUEST", { module });
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  return ctx;
}

export function isFailure(value: WorkspaceContext | ActionResult<never>): value is ActionResult<never> {
  return "ok" in value;
}

/** Revalidate one area's pages (and the workspace home). */
export function refreshArea(slug: string, ...areas: string[]) {
  for (const area of areas) revalidatePath(`/w/${slug}/${area}`, "layout");
  if (areas.includes("members")) revalidatePath(`/w/${slug}/leave`, "layout");
  revalidatePath(`/w/${slug}`);
}

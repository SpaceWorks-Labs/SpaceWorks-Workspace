import "server-only";

import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { canManageCampaigns } from "./roles";
import { actionError, NOT_ALLOWED, RATE_LIMITED } from "@/lib/actionResult";

type Workspace = NonNullable<Awaited<ReturnType<typeof getWorkspaceForAction>>>;
type Denied = { error: ReturnType<typeof actionError>; ctx?: never };
type Allowed = { ctx: Workspace; error?: never };

/** Shared preamble for campaign admin actions: signed-in ADMIN of the slug's workspace, module on, not rate limited. */
export async function adminContext(slug: string, opts: { bucket?: "action" | "dataExport"; cost?: number } = {}): Promise<Denied | Allowed> {
  const ctx = await getWorkspaceForAction(slug, "ADMIN", { module: "campaigns" });
  if (!ctx || !canManageCampaigns(ctx.membership)) return { error: actionError(NOT_ALLOWED) };
  if (await isActionRateLimited(opts.bucket ?? "action", ctx.user.id, opts.cost)) return { error: actionError(RATE_LIMITED) };
  return { ctx };
}

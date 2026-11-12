"use server";
import { revalidatePath } from "@/lib/frontend/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canViewServices, canManageServices, canAckIncidents } from "@/lib/roles";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { saveMonitor, manageService } from "@/lib/monitor/manage";

export async function saveMonitorAction(slug: string, input: unknown, id?: string): Promise<ActionResult<Record<string, string>>> {
  const ctx = await getWorkspaceForAction(slug, "ADMIN", { module: "services" });
  if (!ctx || !canManageServices(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", ctx.user.id)) return actionError(RATE_LIMITED);
  const result = await saveMonitor(ctx, input, id);
  if (result.ok) { revalidatePath(`/w/${slug}/services`, "layout"); revalidatePath(`/status/${slug}`, "layout"); }
  return result;
}
export async function serviceAction(slug: string, input: unknown): Promise<ActionResult<Record<string, string>>> {
  const ctx = await getWorkspaceForAction(slug, "MEMBER", { module: "services" });
  if (!ctx || !canViewServices(ctx.membership)) return actionError(NOT_ALLOWED);
  const ack = Boolean(input && typeof input === "object" && "command" in input && input.command === "acknowledge");
  if (ack ? !canAckIncidents(ctx.membership, ctx.workspace) : !canManageServices(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", ctx.user.id)) return actionError(RATE_LIMITED);
  const result = await manageService(ctx, input);
  if (result.ok) { revalidatePath(`/w/${slug}/services`, "layout"); revalidatePath(`/w/${slug}/settings/cloud-accounts`); revalidatePath(`/status/${slug}`, "layout"); }
  return result;
}

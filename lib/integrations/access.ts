import "server-only";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { canManageIntegrations, canLinkExternalAccounts } from "@/lib/roles";
import type { WorkspaceRole } from "@prisma/client";
import type { ModuleKey } from "@/lib/modules";
export async function integrationAccess(slug: string, minRole: WorkspaceRole = "ADMIN", module: ModuleKey = "integrations") {
  const context = await getWorkspaceForAction(slug, minRole, { module });
  if (!context || (minRole === "ADMIN" ? !canManageIntegrations(context.membership) : !canLinkExternalAccounts(context.membership))) throw new Error("You don't have access to do that.");
  if (await isActionRateLimited("apiWrite", context.user.id)) throw new Error("Too many attempts. Wait a minute and try again.");
  return context;
}
export function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

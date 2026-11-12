import "server-only";

import type { WorkspaceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getEffectiveLimits } from "@/lib/limits";
import { getWorkspaceModules } from "@/lib/limits/modules";
import { workspaceUsage } from "@/lib/limits/usage";
import { TOGGLEABLE_MODULES, isModuleEnabled } from "@/lib/modules";
import { REQUESTABLE_LIMITS, type RequestableLimit } from "./constants";
import { listRequestsForWorkspace } from "./list";
import type { OrgRequestRow } from "./types";

export type PlanLimitRow = { key: RequestableLimit; label: string; unit: "count" | "bytes"; used: number | null; limit: number | null };
export type PlanModuleRow = { key: string; label: string; enabled: boolean };
export type PlanView = {
  status: WorkspaceStatus;
  statusReason: string | null;
  plan: string | null;
  limits: PlanLimitRow[];
  modules: PlanModuleRow[];
  requests: OrgRequestRow[];
};

/** Everything the owner plan page shows. Reads only; it works for any workspace status, including SUSPENDED. */
export async function loadPlanView(workspaceId: string): Promise<PlanView> {
  const [workspace, limits, usage, modules, requests] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { status: true, statusReason: true } }),
    getEffectiveLimits(workspaceId),
    workspaceUsage(workspaceId),
    getWorkspaceModules(workspaceId),
    listRequestsForWorkspace(workspaceId, 30),
  ]);
  const used: Record<RequestableLimit, number | null> = {
    maxMembers: usage.members, maxGuests: usage.guests, maxProjects: usage.projects, maxStorageBytes: usage.storageBytes,
    maxFileBytes: null, maxApiTokens: usage.apiTokens, maxWebhooks: usage.webhooks,
    assistantMonthlyTokens: usage.assistantTokensThisMonth, monthlyEmailCap: usage.emailsThisMonth,
  };
  return {
    status: workspace.status,
    statusReason: workspace.statusReason,
    plan: limits.plan,
    limits: (Object.keys(REQUESTABLE_LIMITS) as RequestableLimit[]).map((key) => ({ key, ...REQUESTABLE_LIMITS[key], used: used[key], limit: limits[key] })),
    modules: TOGGLEABLE_MODULES.map((module) => ({ key: module.key, label: module.label, enabled: isModuleEnabled(modules, module.key) })),
    requests,
  };
}

import "server-only";

import { prisma } from "@/lib/db";
import { getInstanceSettings } from "@/lib/instanceSettings";
import { getEffectiveLimits, resolveLimits, type Limits } from "@/lib/limits";
import { workspaceUsage, type WorkspaceUsage } from "@/lib/limits/usage";
import { MODULE_CHOICES, type LimitFieldKey, type ModuleState } from "@/lib/admin/limitFields";

const MB = 1024 * 1024;

const DEFAULT_KEYS = [
  "limits.maxMembers", "limits.maxGuests", "limits.maxProjects", "limits.maxStorageBytes", "limits.maxFileBytes",
  "limits.maxApiTokens", "limits.maxWebhooks", "limits.assistantMonthlyTokens", "limits.monthlyEmailCap", "modules.disabledByDefault",
] as const;

export type OrgLimitsView = {
  /** Editor values: null = inherit. */
  values: Record<LimitFieldKey, number | null>;
  /** What the instance default gives when the override is empty. */
  inherited: Record<LimitFieldKey, number | null>;
  assistantEnabled: "inherit" | "on" | "off";
  plan: string;
  modules: Record<string, ModuleState>;
  usage: WorkspaceUsage;
  effective: Limits;
};

const toMb = (bytes: number | null) => (bytes === null ? null : Math.round(bytes / MB));

function flat(limits: Limits): Record<LimitFieldKey, number | null> {
  return {
    maxMembers: limits.maxMembers,
    maxGuests: limits.maxGuests,
    maxProjects: limits.maxProjects,
    maxStorageMb: toMb(limits.maxStorageBytes),
    maxFileMb: toMb(limits.maxFileBytes),
    maxApiTokens: limits.maxApiTokens,
    maxWebhooks: limits.maxWebhooks,
    assistantMonthlyTokens: limits.assistantMonthlyTokens,
    monthlyEmailCap: limits.monthlyEmailCap,
  };
}

export async function loadOrgLimitsView(workspaceId: string): Promise<OrgLimitsView> {
  const [row, defaults, effective, usage] = await Promise.all([
    prisma.workspaceLimits.findUnique({ where: { workspaceId } }),
    getInstanceSettings(DEFAULT_KEYS),
    getEffectiveLimits(workspaceId),
    workspaceUsage(workspaceId),
  ]);
  const inherited = flat(resolveLimits(null, defaults));
  const modules: Record<string, ModuleState> = {};
  for (const choice of MODULE_CHOICES) {
    modules[choice.key] = row?.disabledModules.includes(choice.key) ? "off" : row?.enabledModules.includes(choice.key) ? "on" : "default";
  }
  return {
    values: {
      maxMembers: row?.maxMembers ?? null,
      maxGuests: row?.maxGuests ?? null,
      maxProjects: row?.maxProjects ?? null,
      maxStorageMb: toMb(row?.maxStorageBytes === null || row?.maxStorageBytes === undefined ? null : Number(row.maxStorageBytes)),
      maxFileMb: toMb(row?.maxFileBytes ?? null),
      maxApiTokens: row?.maxApiTokens ?? null,
      maxWebhooks: row?.maxWebhooks ?? null,
      assistantMonthlyTokens: row?.assistantMonthlyTokens ?? null,
      monthlyEmailCap: row?.monthlyEmailCap ?? null,
    },
    inherited,
    assistantEnabled: row?.assistantEnabled === null || row?.assistantEnabled === undefined ? "inherit" : row.assistantEnabled ? "on" : "off",
    plan: row?.plan ?? "",
    modules,
    usage,
    effective,
  };
}

/** Usage figure (in the editor's unit) for a field, or null when it has none. */

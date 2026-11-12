import { z } from "zod";
import { TOGGLEABLE_MODULES } from "@/lib/modules";
import type { WorkspaceUsage } from "@/lib/limits/usage";

/** Numeric limit fields the super admin can override. Empty = inherit the instance default. */
export const LIMIT_FIELDS = [
  { key: "maxMembers", label: "Members", usage: "members", unit: "count" },
  { key: "maxGuests", label: "Guests", usage: "guests", unit: "count" },
  { key: "maxProjects", label: "Projects", usage: "projects", unit: "count" },
  { key: "maxStorageMb", label: "Storage (MB)", usage: "storageBytes", unit: "mb" },
  { key: "maxFileMb", label: "Largest file (MB)", usage: null, unit: "mb" },
  { key: "maxApiTokens", label: "API tokens", usage: "apiTokens", unit: "count" },
  { key: "maxWebhooks", label: "Webhooks", usage: "webhooks", unit: "count" },
  { key: "assistantMonthlyTokens", label: "Assistant tokens per month", usage: "assistantTokensThisMonth", unit: "count" },
  { key: "monthlyEmailCap", label: "Emails per month", usage: "emailsThisMonth", unit: "count" },
] as const;

export type LimitFieldKey = (typeof LIMIT_FIELDS)[number]["key"];

export const MODULE_CHOICES: ReadonlyArray<{ key: string; label: string }> = [
  ...TOGGLEABLE_MODULES.map((module) => ({ key: module.key as string, label: module.label })),
  { key: "finance.payroll", label: "Finance: payroll" },
];

export type ModuleState = "default" | "on" | "off";

const count = z.number().int().min(0).max(2_000_000_000).nullable();
const mb = z.number().int().min(0).max(100_000_000).nullable();
const moduleState = z.enum(["default", "on", "off"]);
const validModules = new Set(MODULE_CHOICES.map((choice) => choice.key));

export const orgLimitsSchema = z.object({
  workspaceId: z.string().trim().min(1).max(64),
  maxMembers: count,
  maxGuests: count,
  maxProjects: count,
  maxStorageMb: mb,
  maxFileMb: mb,
  maxApiTokens: count,
  maxWebhooks: count,
  assistantMonthlyTokens: count,
  monthlyEmailCap: count,
  assistantEnabled: z.enum(["inherit", "on", "off"]),
  plan: z.string().trim().max(60).nullable(),
  modules: z.record(z.string(), moduleState).refine((map) => Object.keys(map).every((key) => validModules.has(key)), "Unknown module."),
});

export type OrgLimitsInput = z.infer<typeof orgLimitsSchema>;

const MB = 1024 * 1024;

/** Database row shape for WorkspaceLimits data from the editor's input. */
export function limitsInputToRow(input: OrgLimitsInput) {
  const disabledModules: string[] = [];
  const enabledModules: string[] = [];
  for (const [key, state] of Object.entries(input.modules)) {
    if (state === "off") disabledModules.push(key);
    if (state === "on") enabledModules.push(key);
  }
  return {
    maxMembers: input.maxMembers,
    maxGuests: input.maxGuests,
    maxProjects: input.maxProjects,
    maxStorageBytes: input.maxStorageMb === null ? null : BigInt(input.maxStorageMb) * BigInt(MB),
    maxFileBytes: input.maxFileMb === null ? null : Math.min(input.maxFileMb * MB, 2_000_000_000),
    maxApiTokens: input.maxApiTokens,
    maxWebhooks: input.maxWebhooks,
    assistantEnabled: input.assistantEnabled === "inherit" ? null : input.assistantEnabled === "on",
    assistantMonthlyTokens: input.assistantMonthlyTokens,
    monthlyEmailCap: input.monthlyEmailCap,
    plan: input.plan?.trim() ? input.plan.trim() : null,
    disabledModules,
    enabledModules,
  };
}

export type LimitsRow = ReturnType<typeof limitsInputToRow>;

type StoredRow = Omit<LimitsRow, "maxStorageBytes"> & { maxStorageBytes: bigint | null };

/** Numbers only: before/after for each changed numeric limit plus module counts. */
export function limitsAuditMetadata(before: StoredRow | null, after: LimitsRow): Record<string, string | number | boolean | null> {
  const num = (value: bigint | number | null | undefined) => (value === null || value === undefined ? null : Number(value));
  const keys = ["maxMembers", "maxGuests", "maxProjects", "maxStorageBytes", "maxFileBytes", "maxApiTokens", "maxWebhooks", "assistantMonthlyTokens", "monthlyEmailCap"] as const;
  const meta: Record<string, string | number | boolean | null> = {};
  const changed: string[] = [];
  for (const key of keys) {
    const from = num(before?.[key]);
    const to = num(after[key]);
    if (from === to) continue;
    changed.push(key);
    meta[`${key}_from`] = from;
    meta[`${key}_to`] = to;
  }
  meta.changed = changed.join(",");
  meta.modulesDisabled = after.disabledModules.length;
  meta.modulesEnabled = after.enabledModules.length;
  return meta;
}

/** Current usage for a limit field, in the field's display unit (MB for byte limits); null when the field has no usage counter. */
export function usageFor(field: { usage: keyof WorkspaceUsage | null; unit: "count" | "mb" }, usage: WorkspaceUsage): number | null {
  if (!field.usage) return null;
  const value = usage[field.usage];
  return field.unit === "mb" ? Math.round((value / MB) * 10) / 10 : value;
}

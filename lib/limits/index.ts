import "server-only";

import { prisma } from "@/lib/db";
import { getInstanceSettings } from "@/lib/instanceSettings";
import { maxUploadBytes } from "@/lib/storage/policy";

/** Effective limits for one workspace. `null` means unlimited. */
export type Limits = {
  maxMembers: number | null;
  maxGuests: number | null;
  maxProjects: number | null;
  maxStorageBytes: number | null;
  /** Never null: falls back to the instance upload ceiling (UPLOAD_MAX_BYTES). */
  maxFileBytes: number;
  maxApiTokens: number | null;
  maxWebhooks: number | null;
  assistantEnabled: boolean;
  assistantMonthlyTokens: number | null;
  monthlyEmailCap: number | null;
  plan: string | null;
  /** Merged module switches (workspace override over instance default). */
  disabledModules: string[];
  enabledModules: string[];
};

type WorkspaceOverride = {
  maxMembers: number | null;
  maxGuests: number | null;
  maxProjects: number | null;
  maxStorageBytes: bigint | null;
  maxFileBytes: number | null;
  maxApiTokens: number | null;
  maxWebhooks: number | null;
  assistantEnabled: boolean | null;
  assistantMonthlyTokens: number | null;
  monthlyEmailCap: number | null;
  plan: string | null;
  disabledModules: string[];
  enabledModules: string[];
};

type InstanceDefaults = Record<string, string | undefined>;

const CACHE_TTL_MS = 30_000;
const CACHE_KEY = Symbol.for("sww.limits.cache");
type Entry = { at: number; value: Limits };
type GlobalWithCache = typeof globalThis & { [CACHE_KEY]?: Map<string, Entry> };

function cache(): Map<string, Entry> {
  const g = globalThis as GlobalWithCache;
  return (g[CACHE_KEY] ??= new Map());
}

/** Drop the cached limits of one workspace, or of every workspace (instance defaults changed). */
export function invalidateLimits(workspaceId?: string): void {
  if (workspaceId) cache().delete(workspaceId);
  else cache().clear();
}

function parseCount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw.trim());
  return raw.trim() !== "" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** "a, b" or '["a","b"]'. */
export function parseModuleList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const text = raw.trim();
  let items: unknown[] = text.split(",");
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      // Fall through to the comma list.
    }
  }
  return [...new Set(items.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

/** Pure precedence: workspace override, then instance default, then code default. */
export function resolveLimits(override: WorkspaceOverride | null, defaults: InstanceDefaults, uploadCeiling = maxUploadBytes()): Limits {
  const pick = (own: number | null | undefined, key: string) => own ?? parseCount(defaults[key]);
  const enabled = override?.enabledModules ?? [];
  const disabledByDefault = parseModuleList(defaults["modules.disabledByDefault"]).filter((key) => !enabled.includes(key));
  return {
    maxMembers: pick(override?.maxMembers, "limits.maxMembers"),
    maxGuests: pick(override?.maxGuests, "limits.maxGuests"),
    maxProjects: pick(override?.maxProjects, "limits.maxProjects"),
    maxStorageBytes: pick(override?.maxStorageBytes === null || override?.maxStorageBytes === undefined ? null : Number(override.maxStorageBytes), "limits.maxStorageBytes"),
    maxFileBytes: pick(override?.maxFileBytes, "limits.maxFileBytes") ?? uploadCeiling,
    maxApiTokens: pick(override?.maxApiTokens, "limits.maxApiTokens"),
    maxWebhooks: pick(override?.maxWebhooks, "limits.maxWebhooks"),
    assistantEnabled: override?.assistantEnabled ?? true,
    assistantMonthlyTokens: pick(override?.assistantMonthlyTokens, "limits.assistantMonthlyTokens"),
    monthlyEmailCap: pick(override?.monthlyEmailCap, "limits.monthlyEmailCap"),
    plan: override?.plan ?? null,
    disabledModules: [...new Set([...(override?.disabledModules ?? []), ...disabledByDefault])],
    enabledModules: [...enabled],
  };
}

const DEFAULT_KEYS = [
  "limits.maxMembers", "limits.maxGuests", "limits.maxProjects", "limits.maxStorageBytes", "limits.maxFileBytes",
  "limits.maxApiTokens", "limits.maxWebhooks", "limits.assistantMonthlyTokens", "limits.monthlyEmailCap", "modules.disabledByDefault",
] as const;

/** Resolved limits for a workspace; cached for 30 seconds per process. */
export async function getEffectiveLimits(workspaceId: string): Promise<Limits> {
  const hit = cache().get(workspaceId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const [override, defaults] = await Promise.all([
    prisma.workspaceLimits.findUnique({ where: { workspaceId } }),
    getInstanceSettings(DEFAULT_KEYS),
  ]);
  const value = resolveLimits(override, defaults);
  cache().set(workspaceId, { at: Date.now(), value });
  return value;
}

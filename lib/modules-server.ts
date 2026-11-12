import "server-only";

import { prisma } from "@/lib/db";
import { getInstanceSettings } from "@/lib/instanceSettings";
import { resolveLimits } from "@/lib/limits";
import { getWorkspaceModules } from "@/lib/limits/modules";
import { isModuleEnabled, type ModuleKey } from "@/lib/modules";

/** True when the module is on for the workspace (core is always on). */
export async function workspaceHasModule(workspaceId: string, key: ModuleKey): Promise<boolean> {
  return key === "core" || isModuleEnabled(await getWorkspaceModules(workspaceId), key);
}

/**
 * Ids of every workspace where the module is off, for scheduled jobs:
 * `where: { workspaceId: { notIn: await workspacesWithoutModule("social") } }`.
 * One query for all workspaces, using the same precedence as getEffectiveLimits.
 */
export async function workspacesWithoutModule(key: ModuleKey): Promise<string[]> {
  if (key === "core") return [];
  const [defaults, rows] = await Promise.all([
    getInstanceSettings(["modules.disabledByDefault"] as const),
    prisma.workspace.findMany({ select: { id: true, limits: true }, take: 100_000 }),
  ]);
  return rows.filter((row) => {
    const { disabledModules, enabledModules } = resolveLimits(row.limits, defaults);
    return !isModuleEnabled({ disabledModules, enabledModules }, key);
  }).map((row) => row.id);
}

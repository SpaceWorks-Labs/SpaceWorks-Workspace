import "server-only";

import type { ModuleSettings } from "@/lib/modules";
import { getEffectiveLimits } from "@/lib/limits";

/** Module switches for a workspace: its own overrides merged with the instance defaults. */
export async function getWorkspaceModules(workspaceId: string): Promise<ModuleSettings> {
  const limits = await getEffectiveLimits(workspaceId);
  return { disabledModules: limits.disabledModules, enabledModules: limits.enabledModules };
}

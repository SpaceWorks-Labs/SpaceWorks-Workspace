import type { WorkspaceRole } from "@prisma/client";
import type { ModuleKey } from "@/lib/modules";
import { modulePathEnabled, SUSPENDED_PATHS, workspaceBasePath, type NavContext } from "@/lib/nav";
import { hasRoleAtLeast } from "@/lib/roles";

/**
 * Workspace settings tabs, filtered with the same rules as the sidebar
 * (role, module switches, suspended organisations). `minRole` matches each
 * page's `requireWorkspace` guard; tests/unit/role-guards.test.ts checks it.
 * Paths are below /w/<slug>; App review settings live under its own area.
 */
export type SettingsTabConfig = { key: string; label: string; path: string; minRole: WorkspaceRole; module: ModuleKey };

export const SETTINGS_TABS: readonly SettingsTabConfig[] = [
  { key: "general", label: "General", path: "/settings", minRole: "ADMIN", module: "core" },
  { key: "members", label: "Members", path: "/settings/members", minRole: "ADMIN", module: "core" },
  { key: "invitations", label: "Invitations", path: "/settings/invitations", minRole: "ADMIN", module: "core" },
  { key: "labels", label: "Labels", path: "/settings/labels", minRole: "ADMIN", module: "core" },
  { key: "api-tokens", label: "API tokens", path: "/settings/api-tokens", minRole: "ADMIN", module: "core" },
  { key: "notifications", label: "Notifications", path: "/settings/notifications", minRole: "ADMIN", module: "core" },
  { key: "social", label: "Social", path: "/settings/social", minRole: "ADMIN", module: "social" },
  { key: "integrations", label: "Integrations", path: "/settings/integrations", minRole: "ADMIN", module: "integrations" },
  { key: "webhooks", label: "Webhooks", path: "/settings/notifications#webhooks", minRole: "ADMIN", module: "integrations" },
  { key: "messaging", label: "Messaging", path: "/settings/messaging", minRole: "ADMIN", module: "integrations" },
  { key: "cloud-accounts", label: "Cloud accounts", path: "/settings/cloud-accounts", minRole: "ADMIN", module: "integrations" },
  { key: "onboarding", label: "Onboarding", path: "/settings/onboarding", minRole: "ADMIN", module: "people" },
  { key: "payments", label: "Payments", path: "/settings/payments", minRole: "ADMIN", module: "core" },
  { key: "email", label: "Email sending", path: "/settings/email", minRole: "ADMIN", module: "core" },
  { key: "analytics", label: "Connected analytics", path: "/settings/analytics", minRole: "ADMIN", module: "analytics" },
  { key: "retention", label: "Retention", path: "/settings/retention", minRole: "ADMIN", module: "core" },
  { key: "export", label: "Export", path: "/settings/export", minRole: "ADMIN", module: "core" },
  { key: "import", label: "Import", path: "/settings/import", minRole: "ADMIN", module: "core" },
  { key: "app-reviews", label: "App reviews", path: "/app-reviews/settings", minRole: "ADMIN", module: "social" },
  { key: "plan", label: "Plan & limits", path: "/settings/plan", minRole: "OWNER", module: "core" },
  { key: "audit", label: "Audit log", path: "/settings/audit", minRole: "ADMIN", module: "core" },
];

export type ResolvedSettingsTab = { key: string; label: string; href: string };

/** Tabs this member may open, with hrefs for the workspace. */
export function settingsTabsFor(slug: string, context: NavContext): ResolvedSettingsTab[] {
  const base = workspaceBasePath(slug);
  return SETTINGS_TABS.filter((tab) => {
    if (context.workspace.status === "SUSPENDED" && !SUSPENDED_PATHS.includes(tab.path)) return false;
    return modulePathEnabled(tab.path, tab.module, context.enabledModules) && hasRoleAtLeast(context.role, tab.minRole);
  }).map((tab) => ({ key: tab.key, label: tab.label, href: `${base}${tab.path}` }));
}

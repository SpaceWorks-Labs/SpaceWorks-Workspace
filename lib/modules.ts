/**
 * Module registry: the features a super admin can switch on or off per
 * organisation. Pure and client-safe. `core` is always on. Route prefixes are
 * the first path segment(s) below /w/<slug>/ ("settings/integrations" is a
 * two-segment prefix and wins over the core "settings" area).
 */
export const MODULE_KEYS = [
  "core", "projects", "meetings", "chat", "assistant", "knowledge", "community", "people", "operations", "helpdesk",
  "services", "vault", "secrets", "outreach", "campaigns", "social", "finance", "analytics", "integrations",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  /** Keys of the items in lib/nav.ts that belong to this module. */
  navKeys: readonly string[];
  /** Path prefixes below /w/<slug>/ (no leading slash). */
  routes: readonly string[];
  /** Off until the super admin lists it in `enabledModules`. */
  optIn?: boolean;
  /** Sub-areas that can be named in a path, for example finance/payroll. */
  subs?: readonly string[];
};

export const MODULES: readonly ModuleDefinition[] = [
  { key: "core", label: "Core", navKeys: ["home", "my-tasks", "calendar", "notepad", "search", "members", "settings", "notification-routing", "retention", "plan", "payments", "email-sending", "notification-preferences", "notification-accounts", "calendar-subscribe"], routes: ["", "members", "settings", "search", "notepad", "notifications", "my-tasks", "calendar"] },
  { key: "projects", label: "Projects", navKeys: ["projects", "project-blockers", "cycles", "goals", "product-ops"], routes: ["projects", "cycles", "goals", "product-ops"] },
  { key: "meetings", label: "Meetings", navKeys: ["meetings", "decisions", "sign-offs"], routes: ["meetings", "sign"] },
  { key: "chat", label: "Chat", navKeys: ["channels", "dms"], routes: ["chat", "dm"] },
  { key: "assistant", label: "Assistant", navKeys: ["assistant", "boardroom"], routes: ["assistant", "boardroom"] },
  { key: "knowledge", label: "Knowledge", navKeys: ["docs", "files", "templates", "forms", "links", "documents"], routes: ["docs", "files", "templates", "forms", "links", "documents"] },
  { key: "community", label: "Community", navKeys: ["announcements", "activity", "changelog", "polls", "ideas"], routes: ["announcements", "activity", "changelog", "polls", "ideas"] },
  { key: "people", label: "People", navKeys: ["teams", "org-people", "my-onboarding", "onboarding", "rota", "leave", "volunteering", "hiring"], routes: ["teams", "organisation", "onboarding", "settings/onboarding", "hiring", "leave", "volunteering", "rota"] },
  { key: "operations", label: "Operations", navKeys: ["safety", "safeguarding", "governance"], routes: ["safety", "safeguarding", "governance"] },
  { key: "helpdesk", label: "Help desk", navKeys: ["helpdesk", "requests"], routes: ["helpdesk", "requests"] },
  { key: "services", label: "Services and assets", navKeys: ["services", "catalogue", "assets", "it", "stock"], routes: ["services", "catalogue", "assets", "it", "stock"] },
  { key: "vault", label: "Vault", navKeys: ["vault"], routes: ["vault"] },
  { key: "secrets", label: "Secrets", navKeys: ["secrets"], routes: ["secrets"] },
  { key: "outreach", label: "Outreach", navKeys: ["contacts", "organisations", "pipeline", "marketing"], routes: ["contacts", "marketing"] },
  { key: "campaigns", label: "Email campaigns", navKeys: ["campaigns"], routes: ["campaigns"] },
  { key: "social", label: "Social and reviews", navKeys: ["social", "seo", "app-reviews", "app-reviews-settings"], routes: ["social", "seo", "app-reviews", "settings/social"] },
  { key: "finance", label: "Finance", navKeys: ["finance", "staff-advances", "payroll", "subscriptions", "funding", "money-controls"], routes: ["finance", "funding", "money-controls", "subscriptions"], subs: ["payroll"] },
  { key: "analytics", label: "Analytics", navKeys: ["analytics", "connected-analytics"], routes: ["analytics", "settings/analytics"] },
  { key: "integrations", label: "Integrations", navKeys: ["integrations", "messaging", "cloud-accounts", "webhooks"], routes: ["settings/integrations", "settings/messaging", "settings/cloud-accounts", "webhooks"] },
];

const BY_KEY = new Map(MODULES.map((module) => [module.key, module]));

export function isModuleKey(value: string): value is ModuleKey {
  return BY_KEY.has(value as ModuleKey);
}

export function moduleDefinition(key: ModuleKey): ModuleDefinition {
  return BY_KEY.get(key)!;
}

/** Modules a super admin can toggle (everything except core). */
export const TOGGLEABLE_MODULES = MODULES.filter((module) => module.key !== "core");

/** Longest prefix first, so "settings/integrations" beats "settings". */
const ROUTE_TABLE = MODULES.flatMap((module) => module.routes.filter(Boolean).map((route) => ({ route, key: module.key })))
  .sort((a, b) => b.route.length - a.route.length);

/**
 * Module and optional sub-area for a pathname like /w/<slug>/finance/payroll.
 * Returns null for core routes and for paths outside a workspace.
 */
export function moduleRouteForPath(pathname: string): { module: ModuleKey; sub: string | null } | null {
  const path = pathname.split(/[?#]/)[0] ?? "";
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "w" || parts.length < 3) return null;
  const rest = parts.slice(2).map((part) => part.toLowerCase());
  for (const { route, key } of ROUTE_TABLE) {
    const prefix = route.split("/");
    if (!prefix.every((segment, index) => rest[index] === segment)) continue;
    if (key === "core") return null;
    const sub = moduleDefinition(key).subs?.find((name) => rest[prefix.length] === name) ?? null;
    return { module: key, sub };
  }
  return null;
}

/** Module owning a first path segment such as "vault" or "requests"; core for anything unlisted. Server Actions pass this so the gate never depends on the page the client posted from. */
export function moduleForArea(area: string): ModuleKey {
  return moduleForPath(`/w/_/${area}`) ?? "core";
}

export function moduleForPath(pathname: string): ModuleKey | null {
  return moduleRouteForPath(pathname)?.module ?? null;
}

export type ModuleSettings = { disabledModules: string[]; enabledModules: string[] };

/** Core is always on; opt-in modules need `enabledModules`; the rest are on unless disabled. */
export function isModuleEnabled(settings: ModuleSettings | null | undefined, key: ModuleKey, registry: readonly ModuleDefinition[] = MODULES): boolean {
  if (key === "core") return true;
  if (!settings) return !registry.find((module) => module.key === key)?.optIn;
  if (settings.disabledModules.includes(key)) return false;
  if (registry.find((module) => module.key === key)?.optIn) return settings.enabledModules.includes(key);
  return true;
}

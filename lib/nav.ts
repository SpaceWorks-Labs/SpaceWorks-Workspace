import type { WorkspaceRole } from "@prisma/client";
import type { ModuleKey, ModuleSettings } from "@/lib/modules";
import { isModuleEnabled, moduleRouteForPath } from "@/lib/modules";
import { canViewFinance, hasRoleAtLeast } from "@/lib/roles";

/**
 * The single navigation config for the workspace sidebar (text-only, grouped).
 * Every product area lives here once; pages still enforce their own access
 * with `requireWorkspace(slug, minRole)`. Hiding a link is not authorization.
 */
export type NavRequirement = "finance" | "payroll";

export type NavItemConfig = {
  key: string;
  label: string;
  /** Feature module this item belongs to (lib/modules.ts); core is always on. */
  module: ModuleKey;
  /** Path below /w/<slug>; "" is the workspace home. */
  path: string;
  minRole: WorkspaceRole;
  requires?: NavRequirement;
  /** Match only the exact path (default: the path and anything below it). */
  exact?: boolean;
};

export type NavGroupConfig = { key: string; label: string | null; /** Starts closed in the sidebar (the group holding the current page still opens). */ collapsedByDefault?: boolean; items: NavItemConfig[] };

export const NAV_GROUPS: readonly NavGroupConfig[] = [
  {
    key: "home",
    label: null,
    items: [
      { key: "home", label: "Home", path: "", minRole: "GUEST", exact: true, module: "core" },
      { key: "my-tasks", label: "My tasks", path: "/my-tasks", minRole: "MEMBER", module: "core" },
      { key: "calendar", label: "Calendar", path: "/calendar", minRole: "GUEST", exact: true, module: "core" },
      { key: "notepad", label: "Notepad", path: "/notepad", minRole: "GUEST", module: "core" },
      { key: "search", label: "Search", path: "/search", minRole: "GUEST", module: "core" },
      { key: "analytics", label: "Reports & analytics", path: "/analytics", minRole: "MEMBER", module: "analytics" },
    ],
  },
  {
    key: "work",
    label: "Work",
    items: [
      { key: "projects", label: "Projects", path: "/projects", minRole: "GUEST", module: "projects" },
      { key: "project-blockers", label: "Blockers", path: "/projects/blockers", minRole: "GUEST", module: "projects" },
      { key: "cycles", label: "Cycles", path: "/cycles", minRole: "MEMBER", module: "projects" },
      { key: "goals", label: "Goals", path: "/goals", minRole: "MEMBER", module: "projects" },
      { key: "meetings", label: "Meetings", path: "/meetings", minRole: "GUEST", module: "meetings" },
      { key: "decisions", label: "Decisions", path: "/meetings/decisions", minRole: "GUEST", module: "meetings" },
      { key: "sign-offs", label: "Sign-offs", path: "/sign", minRole: "GUEST", module: "meetings" },
      { key: "product-ops", label: "Product and engineering", path: "/product-ops", minRole: "MEMBER", module: "projects" },
    ],
  },
  {
    key: "chat",
    label: "Chat",
    items: [
      { key: "channels", label: "Channels", path: "/chat", minRole: "GUEST", module: "chat" },
      { key: "dms", label: "Direct messages", path: "/dm", minRole: "MEMBER", module: "chat" },
      { key: "assistant", label: "Assistant", path: "/assistant", minRole: "MEMBER", module: "assistant" },
      { key: "boardroom", label: "Boardroom", path: "/boardroom", minRole: "MEMBER", module: "assistant" },
    ],
  },
  {
    key: "knowledge",
    label: "Knowledge",
    items: [
      { key: "docs", label: "Docs", path: "/docs", minRole: "GUEST", module: "knowledge" },
      { key: "files", label: "Files", path: "/files", minRole: "GUEST", module: "knowledge" },
      { key: "templates", label: "Templates", path: "/templates", minRole: "MEMBER", module: "knowledge" },
      { key: "forms", label: "Forms", path: "/forms", minRole: "MEMBER", module: "knowledge" },
      { key: "links", label: "Links", path: "/links", minRole: "GUEST", module: "knowledge" },
      { key: "documents", label: "Official documents", path: "/documents", minRole: "ADMIN", module: "knowledge" },
    ],
  },
  {
    key: "community",
    label: "Community",
    items: [
      { key: "announcements", label: "Announcements", path: "/announcements", minRole: "GUEST", module: "community" },
      { key: "activity", label: "Activity", path: "/activity", minRole: "GUEST", module: "community" },
      { key: "changelog", label: "Changelog", path: "/changelog", minRole: "GUEST", module: "community" },
      { key: "polls", label: "Polls", path: "/polls", minRole: "MEMBER", module: "community" },
      { key: "ideas", label: "Ideas", path: "/ideas", minRole: "MEMBER", module: "community" },
    ],
  },
  {
    key: "people",
    label: "People",
    items: [
      { key: "members", label: "Members", path: "/members", minRole: "GUEST", module: "core" },
      { key: "teams", label: "Teams", path: "/teams", minRole: "GUEST", module: "people" },
      { key: "org-people", label: "Organisation", path: "/organisation", minRole: "MEMBER", module: "people" },
      { key: "my-onboarding", label: "Onboarding", path: "/onboarding", minRole: "GUEST", module: "people" },
    ],
  },
  {
    key: "operations",
    collapsedByDefault: true,
    label: "Operations",
    items: [
      { key: "safety", label: "Safety & facilities", path: "/safety", minRole: "MEMBER", module: "operations" },
      { key: "safeguarding", label: "Safeguarding", path: "/safeguarding", minRole: "MEMBER", module: "operations" },
      { key: "governance", label: "Governance", path: "/governance", minRole: "ADMIN", module: "operations" },
      { key: "rota", label: "Rota", path: "/rota", minRole: "MEMBER", module: "people" },
      { key: "leave", label: "Leave", path: "/leave", minRole: "MEMBER", module: "people" },
      { key: "volunteering", label: "Volunteer hours", path: "/volunteering", minRole: "MEMBER", module: "people" },
      { key: "hiring", label: "Hiring", path: "/hiring", minRole: "ADMIN", module: "people" },
    ],
  },
  {
    key: "support",
    collapsedByDefault: true,
    label: "Support & IT",
    items: [
      { key: "helpdesk", label: "Help desk", path: "/helpdesk", minRole: "MEMBER", module: "helpdesk" },
      { key: "requests", label: "Requests", path: "/requests", minRole: "MEMBER", module: "helpdesk" },
      { key: "services", label: "Services", path: "/services", minRole: "MEMBER", module: "services" },
      { key: "catalogue", label: "Service catalogue", path: "/catalogue", minRole: "MEMBER", module: "services" },
      { key: "assets", label: "Assets", path: "/assets", minRole: "MEMBER", module: "services" },
      { key: "it", label: "IT administration", path: "/it", minRole: "MEMBER", module: "services" },
      { key: "stock", label: "Stock", path: "/stock", minRole: "MEMBER", module: "services" },
      { key: "vault", label: "Vault", path: "/vault", minRole: "MEMBER", module: "vault" },
      { key: "secrets", label: "Secrets", path: "/secrets", minRole: "MEMBER", module: "secrets" },
    ],
  },
  {
    key: "outreach",
    collapsedByDefault: true,
    label: "Outreach",
    items: [
      { key: "contacts", label: "Contacts", path: "/contacts", minRole: "MEMBER", module: "outreach" },
      { key: "organisations", label: "Companies", path: "/contacts/organisations", minRole: "MEMBER", module: "outreach" },
      { key: "pipeline", label: "Pipeline", path: "/contacts/pipeline", minRole: "MEMBER", module: "outreach" },
      { key: "marketing", label: "Marketing", path: "/marketing", minRole: "MEMBER", module: "outreach" },
      { key: "campaigns", label: "Email campaigns", path: "/campaigns", minRole: "MEMBER", module: "campaigns" },
      { key: "social", label: "Social", path: "/social", minRole: "MEMBER", module: "social" },
      { key: "app-reviews", label: "App reviews", path: "/app-reviews", minRole: "MEMBER", module: "social" },
      { key: "seo", label: "SEO", path: "/seo", minRole: "ADMIN", module: "social" },
    ],
  },
  {
    key: "finance",
    collapsedByDefault: true,
    label: "Finance",
    items: [
      { key: "finance", label: "Finance", path: "/finance", minRole: "MEMBER", requires: "finance", module: "finance" },
      { key: "staff-advances", label: "Staff advances", path: "/finance/advances", minRole: "MEMBER", module: "finance" },
      { key: "payroll", label: "Payroll", path: "/finance/payroll", minRole: "MEMBER", requires: "payroll", module: "finance" },
      { key: "subscriptions", label: "Subscriptions", path: "/subscriptions", minRole: "MEMBER", module: "finance" },
      { key: "funding", label: "Funding and impact", path: "/funding", minRole: "ADMIN", module: "finance" },
      { key: "money-controls", label: "Money controls", path: "/money-controls", minRole: "ADMIN", module: "finance" },
    ],
  },
  {
    key: "settings",
    collapsedByDefault: true,
    label: "Settings",
    items: [
      { key: "settings", label: "Workspace", path: "/settings", minRole: "ADMIN", module: "core" },
      { key: "integrations", label: "Integrations", path: "/settings/integrations", minRole: "ADMIN", module: "integrations" },
      { key: "messaging", label: "Messaging", path: "/settings/messaging", minRole: "ADMIN", module: "integrations" },
      { key: "notification-routing", label: "Notification rules", path: "/settings/notifications", minRole: "ADMIN", module: "core" },
      { key: "webhooks", label: "Webhooks", path: "/settings/notifications#webhooks", minRole: "ADMIN", module: "integrations" },
      { key: "cloud-accounts", label: "Cloud accounts", path: "/settings/cloud-accounts", minRole: "ADMIN", module: "integrations" },
      { key: "retention", label: "Retention", path: "/settings/retention", minRole: "ADMIN", module: "core" },
      { key: "app-reviews-settings", label: "App review settings", path: "/app-reviews/settings", minRole: "ADMIN", module: "social" },
      { key: "onboarding", label: "Onboarding templates", path: "/settings/onboarding", minRole: "ADMIN", module: "people" },
      { key: "plan", label: "Plan & limits", path: "/settings/plan", minRole: "OWNER", module: "core" },
      { key: "payments", label: "Payments", path: "/settings/payments", minRole: "ADMIN", module: "core" },
      { key: "email-sending", label: "Email sending", path: "/settings/email", minRole: "ADMIN", module: "core" },
      { key: "connected-analytics", label: "Connected analytics", path: "/settings/analytics", minRole: "ADMIN", module: "analytics" },
    ],
  },
  {
    key: "personal",
    collapsedByDefault: true,
    label: "Preferences",
    items: [
      { key: "notification-preferences", label: "Notification preferences", path: "/notifications/preferences", minRole: "GUEST", module: "core" },
      { key: "notification-accounts", label: "Connected accounts", path: "/notifications/accounts", minRole: "MEMBER", module: "core" },
      { key: "calendar-subscribe", label: "Personal calendar feed", path: "/calendar/subscribe", minRole: "GUEST", module: "core" },
    ],
  },
];

export type NavContext = {
  /** `canViewPayroll` for this member (a tenant grant, or the super admin); role alone never shows payroll. */
  payrollAccess?: boolean;
  /** Per-workspace module switches; omitted means every module is on. */
  enabledModules?: ModuleSettings | null;
  role: WorkspaceRole;
  /** A SUSPENDED organisation only opens its settings home and plan page to owners and admins. */
  workspace: { financeVisibleToMembers: boolean; status?: string };
};

export type ResolvedNavItem = { key: string; label: string; href: string; exact: boolean };
export type ResolvedNavGroup = { key: string; label: string | null; collapsedByDefault: boolean; items: ResolvedNavItem[] };

export function workspaceBasePath(slug: string) {
  return `/w/${encodeURIComponent(slug)}`;
}

/** Paths a suspended organisation still serves (see `passesWorkspaceGate`). */
export const SUSPENDED_PATHS: readonly string[] = ["/settings", "/settings/plan"];

/** Is a module-owned path switched off, including sub-areas such as "finance.payroll"? */
export function modulePathEnabled(path: string, module: ModuleKey, settings: ModuleSettings | null | undefined) {
  if (settings && !isModuleEnabled(settings, module)) return false;
  const sub = moduleRouteForPath(`/w/_${path.split("#")[0]}`)?.sub;
  return !(sub && settings?.disabledModules.includes(`${module}.${sub}`));
}

function allowed(item: NavItemConfig, context: NavContext) {
  if (context.workspace.status === "SUSPENDED" && !SUSPENDED_PATHS.includes(item.path)) return false;
  if (!modulePathEnabled(item.path, item.module, context.enabledModules)) return false;
  if (!hasRoleAtLeast(context.role, item.minRole)) return false;
  if (item.requires === "payroll") return context.payrollAccess === true;
  if (item.requires === "finance") return canViewFinance({ role: context.role }, context.workspace);
  return true;
}

/** Groups and links visible to a member, with hrefs for this workspace. Empty groups are dropped. */
export function navForMember(slug: string, context: NavContext): ResolvedNavGroup[] {
  const base = workspaceBasePath(slug);
  return NAV_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    collapsedByDefault: Boolean(group.collapsedByDefault),
    items: group.items
      .filter((item) => allowed(item, context))
      .map((item) => ({ key: item.key, label: item.label, href: `${base}${item.path}`, exact: Boolean(item.exact) })),
  })).filter((group) => group.items.length > 0);
}

/** Is `pathname` the active page for `item`? The longest matching href wins (see `activeNavKey`). */
export function navItemMatches(item: ResolvedNavItem, pathname: string) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Key of the single active item: the most specific match (so /settings/integrations beats /settings). */
export function activeNavKey(groups: ResolvedNavGroup[], pathname: string): string | null {
  let best: ResolvedNavItem | null = null;
  for (const item of groups.flatMap((group) => group.items)) {
    if (navItemMatches(item, pathname) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}

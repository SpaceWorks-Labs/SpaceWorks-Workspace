import { describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { NAV_GROUPS, navForMember, type NavContext } from "@/lib/nav";
import { settingsTabsFor } from "@/lib/settingsTabs";
import { homePathFor, lastWorkspacePath } from "@/lib/homePath";

/** Each role's own view of the shell (docs/ROLES.md). */
const workspace = { financeVisibleToMembers: false, status: "ACTIVE" };
const ctx = (role: WorkspaceRole, extra: Partial<NavContext> = {}): NavContext => ({ role, workspace, ...extra });
const navKeys = (context: NavContext) => navForMember("kochi", context).flatMap((group) => group.items.map((item) => item.key));
const groupKeys = (context: NavContext) => navForMember("kochi", context).map((group) => group.key);
const tabKeys = (context: NavContext) => settingsTabsFor("kochi", context).map((tab) => tab.key);

describe("guest view", () => {
  it("shows only the areas guests may open", () => {
    expect(navKeys(ctx("GUEST"))).toEqual([
      "home", "calendar", "notepad", "search", "projects", "project-blockers", "meetings", "decisions", "sign-offs", "channels",
      "docs", "files", "links", "announcements", "activity", "changelog", "members", "teams", "my-onboarding",
      "notification-preferences", "calendar-subscribe",
    ]);
  });
  it("has no administration, finance, operations or outreach groups and no settings tabs", () => {
    const groups = groupKeys(ctx("GUEST"));
    for (const key of ["settings", "finance", "operations", "support", "outreach"]) expect(groups).not.toContain(key);
    expect(tabKeys(ctx("GUEST"))).toEqual([]);
  });
});

describe("member view", () => {
  it("shows work areas but no administration", () => {
    const keys = navKeys(ctx("MEMBER"));
    expect(keys).toEqual(expect.arrayContaining(["my-tasks", "dms", "assistant", "vault", "contacts", "staff-advances", "subscriptions"]));
    const adminOnly = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.minRole === "ADMIN" || item.minRole === "OWNER");
    for (const item of adminOnly) expect(keys, item.key).not.toContain(item.key);
    expect(groupKeys(ctx("MEMBER"))).not.toContain("settings");
    expect(tabKeys(ctx("MEMBER"))).toEqual([]);
  });
});

describe("admin and owner views", () => {
  it("gives admins every settings tab except the owner's plan", () => {
    const tabs = tabKeys(ctx("ADMIN"));
    expect(tabs).toEqual(expect.arrayContaining(["general", "members", "invitations", "integrations", "payments", "email", "export", "audit"]));
    expect(tabs).not.toContain("plan");
    expect(navKeys(ctx("ADMIN"))).toEqual(expect.arrayContaining(["settings", "governance", "hiring", "funding", "money-controls", "documents", "seo"]));
  });
  it("adds the plan for owners", () => {
    expect(tabKeys(ctx("OWNER"))).toContain("plan");
    expect(navKeys(ctx("OWNER"))).toContain("plan");
  });
});

describe("grants and switches", () => {
  it("shows payroll only with a payroll grant, never by role alone", () => {
    expect(navKeys(ctx("OWNER"))).not.toContain("payroll");
    expect(navKeys(ctx("MEMBER", { payrollAccess: true }))).toContain("payroll");
    expect(navKeys(ctx("GUEST", { payrollAccess: true }))).not.toContain("payroll");
  });
  it("hides payroll when the super admin switches the finance.payroll sub-area off", () => {
    const enabledModules = { disabledModules: ["finance.payroll"], enabledModules: [] };
    const keys = navKeys(ctx("OWNER", { payrollAccess: true, enabledModules }));
    expect(keys).not.toContain("payroll");
    expect(keys).toContain("finance");
  });
  it("drops settings tabs of switched-off modules", () => {
    const enabledModules = { disabledModules: ["integrations", "social", "people", "analytics"], enabledModules: [] };
    const tabs = tabKeys(ctx("OWNER", { enabledModules }));
    for (const key of ["integrations", "webhooks", "messaging", "cloud-accounts", "social", "app-reviews", "onboarding", "analytics"]) expect(tabs).not.toContain(key);
    expect(tabs).toEqual(expect.arrayContaining(["general", "members", "audit"]));
  });
  it("shows a suspended organisation's owner only the settings home and plan", () => {
    const suspended = { ...workspace, status: "SUSPENDED" };
    expect(navKeys(ctx("OWNER", { workspace: suspended }))).toEqual(["settings", "plan"]);
    expect(tabKeys(ctx("OWNER", { workspace: suspended }))).toEqual(["general", "plan"]);
    expect(tabKeys(ctx("ADMIN", { workspace: suspended }))).toEqual(["general"]);
    expect(navKeys(ctx("MEMBER", { workspace: suspended }))).toEqual([]);
  });
});

describe("landing page per role", () => {
  const workspaces = [{ slug: "alpha" }, { slug: "kochi" }];
  it("sends the super admin to the instance console", () => {
    expect(homePathFor({ isSuperAdmin: true, workspaces, lastSlug: "kochi" })).toBe("/admin");
  });
  it("sends everyone else to their last or first workspace", () => {
    expect(homePathFor({ isSuperAdmin: false, workspaces, lastSlug: "kochi" })).toBe("/w/kochi");
    expect(homePathFor({ isSuperAdmin: false, workspaces, lastSlug: "gone" })).toBe("/w/alpha");
    expect(homePathFor({ isSuperAdmin: false, workspaces: [] })).toBeNull();
  });
  it("gives the console a way back to a workspace", () => {
    expect(lastWorkspacePath({ workspaces, lastSlug: null })).toBe("/w/alpha");
  });
});

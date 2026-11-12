import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import type { WorkspaceRole } from "@prisma/client";
import { NAV_GROUPS } from "@/lib/nav";
import { moduleForPath } from "@/lib/modules";
import * as roles from "@/lib/roles";
import { SETTINGS_TABS } from "@/lib/settingsTabs";

/**
 * Every sidebar item and settings tab must ask for exactly the role its page
 * admits (docs/ROLES.md): a link a role can see must open, and a page a role
 * can open must not be hidden. The page's gate is its
 * `requireWorkspace(workspaceSlug, role)` call, raised by any one-argument
 * role helper in an `if (!canX(membership)) notFound()` guard.
 */
const ORDER: WorkspaceRole[] = ["GUEST", "MEMBER", "ADMIN", "OWNER"];
const rank = (role: WorkspaceRole) => ORDER.indexOf(role);

/** Nav items whose link is deliberately stricter than the page (the page also serves a personal slice). */
const NAV_STRICTER_THAN_PAGE: Record<string, string> = {
  "money-controls": "Members only acknowledge their own custodian handovers there, reached from the notification.",
};

function pageFile(path: string) {
  const clean = path.split("#")[0]!;
  return `app/w/[workspaceSlug]${clean}/page.tsx`;
}

function helperMinRole(name: string): WorkspaceRole | null {
  const helper = (roles as Record<string, unknown>)[name];
  if (typeof helper !== "function" || helper.length !== 1) return null;
  return ORDER.find((role) => (helper as (m: { role: WorkspaceRole }) => boolean)({ role })) ?? "OWNER";
}

/** The lowest role the page lets through. */
function pageMinRole(file: string): WorkspaceRole {
  const source = readFileSync(file, "utf8");
  const guard = source.match(/requireWorkspace\(\s*workspaceSlug\s*(?:,\s*"(GUEST|MEMBER|ADMIN|OWNER)")?/);
  expect(guard, `${file} calls requireWorkspace`).not.toBeNull();
  let min = (guard![1] as WorkspaceRole | undefined) ?? "GUEST";
  for (const match of source.matchAll(/if\s*\(\s*!(can[A-Za-z]+)\([\w.]+\)\s*\)\s*notFound\(\)/g)) {
    const role = helperMinRole(match[1]!);
    if (role && rank(role) > rank(min)) min = role;
  }
  return min;
}

const navItems = NAV_GROUPS.flatMap((group) => group.items);

describe("sidebar items match their page guards", () => {
  it.each(navItems.map((item) => [item.key, item] as const))("%s", (_key, item) => {
    const file = pageFile(item.path || "");
    expect(existsSync(file), `${item.key} has a page at ${file}`).toBe(true);
    const page = pageMinRole(file);
    if (NAV_STRICTER_THAN_PAGE[item.key]) {
      expect(rank(item.minRole), `${item.key} may only be stricter than its page`).toBeGreaterThan(rank(page));
      return;
    }
    expect(item.minRole, `${item.key}: nav ${item.minRole} vs page ${page}`).toBe(page);
  });

  it("puts every item in the module that gates its route", () => {
    for (const item of navItems) {
      if (item.path.includes("#")) continue; // a section of another page (webhooks on notification rules)
      expect(moduleForPath(`/w/_${item.path}`) ?? "core", item.key).toBe(item.module);
    }
  });

  it("only documents exceptions that exist", () => {
    for (const key of Object.keys(NAV_STRICTER_THAN_PAGE)) expect(navItems.some((item) => item.key === key)).toBe(true);
  });
});

describe("settings tabs match their page guards", () => {
  it.each(SETTINGS_TABS.map((tab) => [tab.key, tab] as const))("%s", (_key, tab) => {
    const file = pageFile(tab.path);
    expect(existsSync(file), `${tab.key} has a page at ${file}`).toBe(true);
    expect(tab.minRole, `${tab.key}: tab ${tab.minRole} vs page`).toBe(pageMinRole(file));
    if (!tab.path.includes("#")) expect(moduleForPath(`/w/_${tab.path}`) ?? "core", tab.key).toBe(tab.module);
  });

  it("lists every page under /settings once", () => {
    const paths = new Set(SETTINGS_TABS.map((tab) => tab.path));
    for (const page of ["members", "invitations", "labels", "api-tokens", "notifications", "social", "integrations", "messaging", "cloud-accounts", "onboarding", "payments", "email", "analytics", "retention", "export", "import", "plan", "audit"]) {
      expect(paths.has(`/settings/${page}`), page).toBe(true);
    }
    expect(paths.size).toBe(SETTINGS_TABS.length);
  });

  it("keeps settings items in the sidebar consistent with the tabs", () => {
    const tabs = new Map(SETTINGS_TABS.map((tab) => [tab.path, tab]));
    for (const item of NAV_GROUPS.find((group) => group.key === "settings")!.items) {
      const tab = tabs.get(item.path);
      expect(tab, `${item.key} is also a settings tab`).toBeDefined();
      expect(tab!.minRole, item.key).toBe(item.minRole);
      expect(tab!.module, item.key).toBe(item.module);
    }
  });
});

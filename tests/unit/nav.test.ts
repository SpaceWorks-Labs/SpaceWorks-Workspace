import { describe, expect, it } from "vitest";
import { activeNavKey, NAV_GROUPS, navForMember } from "@/lib/nav";

const keys = (groups: ReturnType<typeof navForMember>) => groups.flatMap((group) => group.items.map((item) => item.key));
const workspace = { financeVisibleToMembers: false };

describe("navigation by role", () => {
  it("shows every area to owners", () => {
    const all = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.key));
    expect(keys(navForMember("kochi", { role: "OWNER", workspace }))).toEqual(all);
  });

  it("hides settings and operations management from members", () => {
    const visible = keys(navForMember("kochi", { role: "MEMBER", workspace }));
    expect(visible).toContain("projects");
    expect(visible).toContain("assistant");
    expect(visible).not.toContain("settings");
    expect(visible).not.toContain("integrations");
    expect(visible).not.toContain("finance");
  });

  it("shows finance to members only when the workspace allows it", () => {
    expect(keys(navForMember("kochi", { role: "MEMBER", workspace: { ...workspace, financeVisibleToMembers: true } }))).toContain("finance");
    expect(keys(navForMember("kochi", { role: "GUEST", workspace: { ...workspace, financeVisibleToMembers: true } }))).not.toContain("finance");
  });

  it("gives guests read areas only", () => {
    const visible = keys(navForMember("kochi", { role: "GUEST", workspace }));
    expect(visible).toEqual(expect.arrayContaining(["home", "announcements", "projects", "docs", "channels"]));
    expect(visible).not.toContain("my-tasks");
    expect(visible).not.toContain("dms");
    expect(visible).not.toContain("assistant");
  });

  it("keeps operations and internal-team areas away from guests", () => {
    const visible = keys(navForMember("kochi", { role: "GUEST", workspace }));
    expect(visible).toEqual(expect.arrayContaining(["teams", "meetings"]));
    for (const key of ["services", "catalogue", "vault", "contacts", "assets", "requests", "subscriptions", "rota", "polls", "ideas", "cycles", "goals", "forms"]) {
      expect(visible).not.toContain(key);
    }
  });

  it("gives members the work and operations areas but no settings", () => {
    const visible = keys(navForMember("kochi", { role: "MEMBER", workspace }));
    expect(visible).toEqual(expect.arrayContaining(["services", "catalogue", "vault", "contacts", "assets", "requests", "subscriptions", "rota", "cycles", "meetings", "goals", "forms", "polls", "ideas"]));
    for (const key of ["notification-routing", "messaging", "cloud-accounts", "onboarding"]) expect(visible).not.toContain(key);
  });

  it("gives every nav item a unique key and path", () => {
    const items = NAV_GROUPS.flatMap((group) => group.items);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
    expect(new Set(items.map((item) => item.path)).size).toBe(items.length);
  });

  it("drops empty groups and builds hrefs under /w/<slug>", () => {
    const groups = navForMember("tinker space", { role: "GUEST", workspace });
    expect(groups.find((group) => group.key === "settings")).toBeUndefined();
    expect(groups[0]!.items[0]!.href).toBe("/w/tinker%20space");
  });

  it("marks the most specific item active", () => {
    const groups = navForMember("kochi", { role: "OWNER", workspace });
    expect(activeNavKey(groups, "/w/kochi")).toBe("home");
    expect(activeNavKey(groups, "/w/kochi/projects/BOT")).toBe("projects");
    expect(activeNavKey(groups, "/w/kochi/settings/integrations")).toBe("integrations");
    expect(activeNavKey(groups, "/w/kochi/settings/members")).toBe("settings");
    expect(activeNavKey(groups, "/w/kochi/dm/abc")).toBe("dms");
    expect(activeNavKey(groups, "/w/kochi/settings/notifications")).toBe("notification-routing");
    expect(activeNavKey(groups, "/w/kochi/services/monitors/abc")).toBe("services");
  });

  it("orders the groups and keeps personal-first items in the first group", () => {
    expect(NAV_GROUPS.map((group) => group.key)).toEqual([
      "home", "work", "chat", "knowledge", "community", "people", "operations", "support", "outreach", "finance", "settings", "personal",
    ]);
    const groups = navForMember("kochi", { role: "MEMBER", workspace });
    expect(groups[0]!.label).toBeNull();
    expect(groups[0]!.items.map((item) => item.key)).toEqual(["home", "my-tasks", "calendar", "notepad", "search", "analytics"]);
  });
});

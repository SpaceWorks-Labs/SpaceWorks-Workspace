import { describe, expect, it } from "vitest";
import { MODULES, isModuleEnabled, moduleForPath, moduleRouteForPath } from "@/lib/modules";
import { NAV_GROUPS } from "@/lib/nav";

describe("moduleForPath", () => {
  it.each([
    ["/w/kochi/projects", "projects"],
    ["/w/kochi/projects/blockers", "projects"],
    ["/w/kochi/dm/abc", "chat"],
    ["/w/kochi/boardroom", "assistant"],
    ["/w/kochi/settings/integrations", "integrations"],
    ["/w/kochi/settings/integrations/github", "integrations"],
    ["/w/kochi/settings/messaging", "integrations"],
    ["/w/kochi/settings/analytics", "analytics"],
    ["/w/kochi/settings/onboarding", "people"],
    ["/w/kochi/finance/payroll", "finance"],
    ["/w/kochi/finance/bank", "finance"],
    ["/w/kochi/campaigns/new", "campaigns"],
    ["/w/kochi/stock", "services"],
    ["/w/kochi/app-reviews/settings", "social"],
    ["/w/kochi/contacts/pipeline?x=1", "outreach"],
  ])("%s -> %s", (path, module) => expect(moduleForPath(path)).toBe(module));

  it.each(["/w/kochi", "/w/kochi/settings", "/w/kochi/settings/plan", "/w/kochi/members", "/w/kochi/search", "/login", "/admin/settings", "/w/kochi/unknown"])("%s is not gated", (path) => {
    expect(moduleForPath(path)).toBeNull();
  });

  it("reports the payroll sub-area", () => {
    expect(moduleRouteForPath("/w/kochi/finance/payroll/run")).toEqual({ module: "finance", sub: "payroll" });
    expect(moduleRouteForPath("/w/kochi/finance/ledger")).toEqual({ module: "finance", sub: null });
  });
});

describe("isModuleEnabled", () => {
  const none = { disabledModules: [], enabledModules: [] };
  it("always enables core and defaults to on", () => {
    expect(isModuleEnabled({ disabledModules: ["core"], enabledModules: [] }, "core")).toBe(true);
    expect(isModuleEnabled(null, "projects")).toBe(true);
    expect(isModuleEnabled(none, "finance")).toBe(true);
  });
  it("honours disabledModules", () => {
    expect(isModuleEnabled({ disabledModules: ["finance"], enabledModules: [] }, "finance")).toBe(false);
  });
  it("requires enabledModules for opt-in modules", () => {
    const registry = MODULES.map((m) => (m.key === "campaigns" ? { ...m, optIn: true } : m));
    expect(isModuleEnabled(none, "campaigns", registry)).toBe(false);
    expect(isModuleEnabled(null, "campaigns", registry)).toBe(false);
    expect(isModuleEnabled({ disabledModules: [], enabledModules: ["campaigns"] }, "campaigns", registry)).toBe(true);
  });
});

describe("registry consistency", () => {
  it("assigns every nav item to exactly the module that lists its key", () => {
    for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
      const owners = MODULES.filter((m) => m.navKeys.includes(item.key)).map((m) => m.key);
      expect(owners, item.key).toEqual([item.module]);
    }
  });
  it("resolves each non-core nav path to its module", () => {
    for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
      if (item.module === "core" || item.path.includes("#")) continue;
      expect(moduleForPath(`/w/x${item.path.split("#")[0]}`), item.key).toBe(item.module);
    }
  });
});

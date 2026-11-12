import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ALL_TOOLS, toolsFor } from "@/lib/assistant/tools";
import { TOOL_MODULE } from "@/lib/assistant/tools/modules";
import type { Principal } from "@/lib/assistant/principal";
import { moduleForFolder } from "@/lib/fileModules";
import { isModuleKey } from "@/lib/modules";
import { disabledEntityTypes, ENTITY_MODULE, moduleForEntityType } from "@/lib/search/entityModules";

const workspace = { id: "ws1", slug: "kochi", name: "Kochi", timezone: "Asia/Kolkata", currency: "INR", financeVisibleToMembers: true };
const admin: Principal = { kind: "user", workspace, userId: "u1", userName: "Meera", role: "ADMIN" };

describe("entity to module map", () => {
  it("maps every entry to a real module and defaults unknown types to core", () => {
    for (const key of Object.values(ENTITY_MODULE)) expect(isModuleKey(key)).toBe(true);
    expect(moduleForEntityType("secret_environment")).toBe("secrets");
    expect(moduleForEntityType("finance_entry")).toBe("finance");
    expect(moduleForEntityType("note")).toBe("core");
    expect(moduleForEntityType("never-heard-of-it")).toBe("core");
  });
  it("lists only the types of disabled modules", () => {
    const off = disabledEntityTypes({ disabledModules: ["finance", "chat"], enabledModules: [] });
    expect(off).toEqual(expect.arrayContaining(["invoice", "message", "channel", "finance_bill"]));
    expect(off).not.toContain("task");
    expect(disabledEntityTypes({ disabledModules: [], enabledModules: [] })).toEqual([]);
  });
});

describe("file folder to module map", () => {
  it("maps managed folders and sends the shared library to knowledge", () => {
    expect(moduleForFolder("/funding/2026")).toBe("finance");
    expect(moduleForFolder("/finance/receipts")).toBe("finance");
    expect(moduleForFolder("/governance/packs")).toBe("operations");
    expect(moduleForFolder("/marketing-assets")).toBe("outreach");
    expect(moduleForFolder("/calendar")).toBe("core");
    expect(moduleForFolder("/")).toBe("knowledge");
    expect(moduleForFolder("/Brand kit")).toBe("knowledge");
  });
});

describe("tool filtering by module", () => {
  it("only maps tools that exist, to real modules", () => {
    const names = new Set<string>(ALL_TOOLS.map((t) => t.name));
    for (const [name, key] of Object.entries(TOOL_MODULE)) {
      expect(names.has(name), name).toBe(true);
      expect(isModuleKey(key)).toBe(true);
    }
    expect(ALL_TOOLS.find((t) => t.name === "sw_finance_summary")?.module).toBe("finance");
    expect(ALL_TOOLS.find((t) => t.name === "sw_list_members")?.module).toBeUndefined();
  });
  it("hides the tools of a disabled module and keeps core ones", () => {
    const all = toolsFor(admin).map((t) => t.name);
    const some = toolsFor(admin, { modules: { disabledModules: ["finance", "chat"], enabledModules: [] } }).map((t) => t.name);
    expect(all).toContain("sw_finance_summary");
    expect(some).not.toContain("sw_finance_summary");
    expect(some).not.toContain("sw_send_channel_message");
    expect(some).toEqual(expect.arrayContaining(["sw_list_members", "sw_search_workspace", "sw_list_tasks"]));
  });
});

describe("proxy sets x-sw-path", () => {
  it("forwards the pathname for a page request and for a Server Action post", async () => {
    vi.doMock("@/lib/rateLimit", () => ({ checkRateLimit: async () => true }));
    const { NextRequest: Req } = await import("next/server");
    const { proxy } = await import("@/proxy");
    const forwarded = (response: Response) => response.headers.get("x-middleware-request-x-sw-path");
    const page = await proxy(new Req("https://app.example.test/w/kochi/finance") as NextRequest);
    expect(forwarded(page)).toBe("/w/kochi/finance");
    const action = await proxy(new Req("https://app.example.test/w/kochi/vault", { method: "POST", headers: { "next-action": "abc123" } }) as NextRequest);
    expect(forwarded(action)).toBe("/w/kochi/vault");
    const api = await proxy(new Req("https://app.example.test/api/v1/tasks") as NextRequest);
    expect(forwarded(api)).toBe("/api/v1/tasks");
  });
});

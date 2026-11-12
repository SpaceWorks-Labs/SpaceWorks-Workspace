import { describe, expect, it } from "vitest";
import { parseModuleList, resolveLimits } from "@/lib/limits";
import { evaluateLimit, formatBytes } from "@/lib/limits/enforce";
import type { WorkspaceUsage } from "@/lib/limits/usage";

const none = { maxMembers: null, maxGuests: null, maxProjects: null, maxStorageBytes: null, maxFileBytes: null, maxApiTokens: null, maxWebhooks: null, assistantEnabled: null, assistantMonthlyTokens: null, monthlyEmailCap: null, plan: null, disabledModules: [], enabledModules: [] };
const usage: WorkspaceUsage = { members: 5, guests: 1, projects: 2, storageBytes: 900, apiTokens: 0, webhooks: 0, assistantTokensThisMonth: 100, emailsThisMonth: 10 };

describe("resolveLimits precedence", () => {
  it("is unlimited with no override and no instance default", () => {
    const limits = resolveLimits(null, {}, 1000);
    expect(limits.maxMembers).toBeNull();
    expect(limits.maxFileBytes).toBe(1000);
    expect(limits.assistantEnabled).toBe(true);
  });

  it("uses the instance default, then lets the workspace override win", () => {
    const defaults = { "limits.maxMembers": "10", "limits.maxFileBytes": "500", "limits.maxStorageBytes": "garbage" };
    expect(resolveLimits(null, defaults, 1000)).toMatchObject({ maxMembers: 10, maxFileBytes: 500, maxStorageBytes: null });
    expect(resolveLimits({ ...none, maxMembers: 3, maxStorageBytes: BigInt(2048) }, defaults, 1000)).toMatchObject({ maxMembers: 3, maxFileBytes: 500, maxStorageBytes: 2048 });
    expect(resolveLimits({ ...none, maxMembers: 0 }, defaults, 1000).maxMembers).toBe(0);
  });

  it("merges module defaults with the workspace overrides", () => {
    const defaults = { "modules.disabledByDefault": "finance, vault" };
    const limits = resolveLimits({ ...none, disabledModules: ["chat"], enabledModules: ["vault"] }, defaults, 1000);
    expect(limits.disabledModules.sort()).toEqual(["chat", "finance"]);
    expect(limits.enabledModules).toEqual(["vault"]);
    expect(parseModuleList('["a", "b"]')).toEqual(["a", "b"]);
  });
});

describe("evaluateLimit messages", () => {
  const limits = resolveLimits({ ...none, maxMembers: 5, maxStorageBytes: BigInt(1000), maxFileBytes: 100 }, {}, 1000);

  it("blocks past the cap with clear copy", () => {
    expect(evaluateLimit("members", limits, usage)).toEqual({ ok: false, error: "This organisation has reached its member limit (5). Ask the instance admin to raise it." });
    expect(evaluateLimit("storageBytes", limits, usage, 200)).toMatchObject({ ok: false });
    expect(evaluateLimit("storageBytes", limits, usage, 100)).toEqual({ ok: true });
    expect(evaluateLimit("fileBytes", limits, usage, 101)).toMatchObject({ ok: false });
  });

  it("allows unlimited kinds and honours the assistant switch", () => {
    expect(evaluateLimit("projects", limits, usage, 1000)).toEqual({ ok: true });
    const off = resolveLimits({ ...none, assistantEnabled: false }, {}, 1000);
    expect(evaluateLimit("assistantTokens", off, usage)).toMatchObject({ ok: false });
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GB");
  });
});

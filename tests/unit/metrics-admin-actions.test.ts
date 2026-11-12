import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ admin: true, saved: [] as unknown[], audit: [] as unknown[], current: {} as Record<string, string | undefined> }));
vi.mock("@/lib/permissions", () => ({
  requireSuperAdminMfa: async () => {
    if (!state.admin) throw new Error("NEXT_NOT_FOUND");
    return { user: { id: "admin_1" } };
  },
}));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("@/lib/frontend/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: async (event: unknown) => { state.audit.push(event); } }));
vi.mock("@/lib/instanceSettings", () => ({
  getInstanceSettings: async () => state.current,
  setInstanceSettings: async (updates: unknown) => { state.saved.push(updates); return 1; },
}));
vi.mock("@/lib/observability", () => ({ testProvider: async () => ({ ok: true, message: "sent" }) }));
vi.mock("@/lib/observability/admin/settings", () => ({ getObservabilityValues: async () => state.current }));

import { rotateMetricsToken, saveObservability, testObservability } from "@/app/actions/observability";

describe("observability admin actions", () => {
  beforeEach(() => { state.admin = true; state.saved = []; state.audit = []; state.current = {}; });

  it("refuses everyone but a fresh super admin", async () => {
    state.admin = false;
    await expect(saveObservability({ "obs.consentMode": "none" })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(testObservability("sentry")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(rotateMetricsToken()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.saved).toEqual([]);
  });

  it("rejects unknown keys and the metrics token (rotate-only)", async () => {
    expect((await saveObservability({ "obs.metrics.token": "x".repeat(40) })).ok).toBe(false);
    expect((await saveObservability({ "smtp.password": "nope" })).ok).toBe(false);
    expect(state.saved).toEqual([]);
  });

  it("refuses to enable a provider with missing settings and bad values", async () => {
    expect((await saveObservability({ "obs.sentry.enabled": "true" })).ok).toBe(false);
    expect((await saveObservability({ "obs.metabase.siteUrl": "http://insecure.example.org" })).ok).toBe(false);
    expect((await saveObservability({ "obs.consentMode": "sometimes" })).ok).toBe(false);
    expect(state.saved).toEqual([]);
  });

  it("saves valid settings and audits keys only, never values", async () => {
    const result = await saveObservability({ "obs.metabase.secretKey": "super-secret-embedding-key", "obs.metabase.siteUrl": "https://bi.example.org", "obs.metabase.enabled": "true" });
    expect(result.ok).toBe(true);
    expect(state.saved).toHaveLength(1);
    expect(JSON.stringify(state.audit)).not.toContain("super-secret-embedding-key");
    expect(JSON.stringify(state.audit)).not.toContain("bi.example.org");
  });

  it("rotates the token, returns it once and never audits it", async () => {
    const result = await rotateMetricsToken();
    expect(result.ok && result.data?.token.length).toBeGreaterThanOrEqual(32);
    const token = result.ok ? result.data!.token : "";
    expect(JSON.stringify(state.audit)).not.toContain(token);
    expect(JSON.stringify(state.saved)).toContain(token);
  });

  it("delegates client providers to the provider test", async () => {
    const result = await testObservability("posthog");
    expect(result).toEqual({ ok: true, data: { message: "sent" } });
    expect((await testObservability("nonsense")).ok).toBe(false);
  });
});

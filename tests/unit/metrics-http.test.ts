import { describe, expect, it, vi } from "vitest";
import { withMetrics } from "@/lib/observability/metrics/http";
import { getMetrics, HTTP_GROUPS, httpGroup } from "@/lib/observability/metrics/registry";

vi.mock("@/lib/apiTokens", () => ({ authenticateApiToken: async () => null }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimitById: async () => true }));
vi.mock("@/lib/assistant/tools", () => ({ executeTool: async () => ({ ok: false, code: "internal", error: "unused" }) }));

describe("http metrics", () => {
  it.each([
    ["/api/v1/tasks/abc123", "api_v1"],
    ["/api/auth/callback/google", "auth"],
    ["/api/files/obj_1", "files"],
    ["/api/internal/jobs", "internal"],
    ["/api/realtime/stream", "realtime"],
    ["/w/secret-workspace/tasks", "other"],
  ])("groups %s as %s", (path, group) => expect(httpGroup(path)).toBe(group));

  it("only ever emits bounded group, method and status_class labels", async () => {
    const handler = withMetrics(async () => new Response(null, { status: 204 }));
    await handler(new Request("http://localhost/api/v1/workspaces/ws_9f8e7d/tasks?email=a@b.co", { method: "PURGE" }));
    const failing = withMetrics(async () => { throw new Error("boom"); });
    await expect(failing(new Request("http://localhost/api/files/x"))).rejects.toThrow("boom");
    const text = await getMetrics().registry.getSingleMetricAsString("sww_http_requests_total");
    expect(text).toContain('group="api_v1",method="OTHER",status_class="2xx"');
    expect(text).toContain('group="files",method="GET",status_class="5xx"');
    expect(text).not.toMatch(/ws_9f8e7d|a@b\.co/);
    for (const [, group] of text.matchAll(/group="([a-z_0-9]+)"/g)) expect(HTTP_GROUPS as readonly string[]).toContain(group);
  });

  it("keeps one registry across module instances", () => {
    expect(getMetrics()).toBe(getMetrics());
    expect((globalThis as Record<symbol, unknown>)[Symbol.for("sww.metrics")]).toBe(getMetrics());
  });
});

describe("wrapped v1 and files handlers", () => {
  it("records an api_v1 request through the shared endpoint helper and a files request through its route", async () => {
    const { getEndpoint } = await import("@/lib/apiTokens/http");
    const response = await getEndpoint(new Request("http://localhost/api/v1/tasks/ABC-1"), "sw_get_task", { ref: "ABC-1" });
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await getMetrics().registry.getSingleMetricAsString("sww_http_requests_total");
    expect(text).toMatch(/group="api_v1",method="GET",status_class="4xx"\} \d+/);
    expect(text).not.toContain("ABC-1");
  });
});

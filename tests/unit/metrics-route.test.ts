import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ values: {} as Record<string, string | undefined> }));
const refresh = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/instanceSettings", () => ({ getInstanceSettings: async () => settings.values }));
vi.mock("@/lib/observability/metrics/gauges", () => ({ refreshGauges: refresh }));

import { GET } from "@/app/api/metrics/route";
import { resetRenderCache } from "@/lib/observability/metrics/render";
import { getMetrics } from "@/lib/observability/metrics/registry";

const TOKEN = "t".repeat(40);
const call = (authorization?: string) => GET(new Request("http://localhost/api/metrics", { headers: authorization ? { authorization } : {} }));

describe("/api/metrics", () => {
  beforeEach(() => {
    settings.values = { "obs.metrics.enabled": "true", "obs.metrics.token": TOKEN };
    resetRenderCache();
    refresh.mockClear();
  });

  it("answers a bodyless 404 without a token", async () => {
    const response = await call();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("answers 404 for a wrong token", async () => {
    expect((await call(`Bearer ${"x".repeat(40)}`)).status).toBe(404);
  });

  it("answers 404 when no token is configured", async () => {
    settings.values = { "obs.metrics.enabled": "true" };
    expect((await call(`Bearer ${TOKEN}`)).status).toBe(404);
  });

  it("answers 404 when metrics are disabled, even with the right token", async () => {
    settings.values = { "obs.metrics.enabled": "false", "obs.metrics.token": TOKEN };
    expect((await call(`Bearer ${TOKEN}`)).status).toBe(404);
  });

  it("serves Prometheus text with the right token", async () => {
    const response = await call(`Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("sww_build_info");
    expect(body).toContain("process_cpu_user_seconds_total");
    expect(body).not.toContain(TOKEN);
  });

  it("honours the 15 second cache", async () => {
    await call(`Bearer ${TOKEN}`);
    await call(`Bearer ${TOKEN}`);
    expect(refresh).toHaveBeenCalledTimes(1);
    resetRenderCache();
    await call(`Bearer ${TOKEN}`);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps labels bounded: no workspace id or email can appear", async () => {
    const m = getMetrics();
    m.workspaces.set({ state: "active" }, 3);
    const body = await (await call(`Bearer ${TOKEN}`)).text();
    const labelNames = new Set([...body.matchAll(/([a-z_]+)="/g)].map((match) => match[1]));
    for (const name of labelNames) expect(["workspace", "workspace_id", "email", "user", "user_id", "slug"]).not.toContain(name);
    expect(body).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});

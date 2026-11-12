import { jwtVerify } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const conn = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const settings = vi.hoisted(() => ({ values: {} as Record<string, string | undefined> }));
vi.mock("@/lib/observability/workspaceConfig", () => ({ resolveWorkspaceConnection: async () => conn.value }));
vi.mock("@/lib/instanceSettings", () => ({ getInstanceSettings: async () => settings.values }));

import { instanceEmbed, workspaceEmbed } from "@/lib/observability/metabase/embed";

const SECRET = "workspace-secret-0123456789abcdef";
const tokenOf = (url: string) => url.split("/embed/dashboard/")[1].split("#")[0];

describe("metabase embed resolution", () => {
  beforeEach(() => {
    process.env.OBS_CSP_FRAME_ORIGINS = "https://bi.example.org";
    conn.value = { provider: "metabase", source: "workspace", active: true, secret: SECRET, config: { siteUrl: "https://bi.example.org", dashboardIds: ["11", "12"] } };
    settings.values = { "obs.metabase.enabled": "true", "obs.metabase.siteUrl": "https://bi.example.org", "obs.metabase.secretKey": "instance-secret-0123456789", "obs.metabase.adminDashboardIds": "3" };
  });

  it("signs a workspace's own dashboard with the server-derived workspace id and its own secret", async () => {
    const result = await workspaceEmbed("ws_1", 12);
    expect(result.selected).toBe(12);
    const { payload } = await jwtVerify(tokenOf(result.embedUrl!), new TextEncoder().encode(SECRET));
    expect(payload).toMatchObject({ resource: { dashboard: 12 }, params: { workspace_id: "ws_1" } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("falls back to the first allowed dashboard when the requested one is not on the list", async () => {
    expect((await workspaceEmbed("ws_1", 3)).selected).toBe(11);
  });

  it("never embeds the instance's dashboards for a workspace that inherits", async () => {
    conn.value = { provider: "metabase", source: "instance", active: true, secret: "instance-secret-0123456789", config: { siteUrl: "https://bi.example.org", dashboardIds: ["3"] } };
    const result = await workspaceEmbed("ws_1", 3);
    expect(result.embedUrl).toBeNull();
    expect(result.dashboards).toEqual([]);
  });

  it("links out for a link-out workspace and when the origin is not frameable", async () => {
    conn.value = { provider: "metabase", source: "linkout", active: false, secret: null, config: { url: "https://bi.example.org/dash" } };
    expect((await workspaceEmbed("ws_1")).linkUrl).toBe("https://bi.example.org/dash");
    conn.value = { provider: "metabase", source: "workspace", active: true, secret: SECRET, config: { siteUrl: "https://bi.example.org", dashboardIds: ["11"] } };
    process.env.OBS_CSP_FRAME_ORIGINS = "";
    const blocked = await workspaceEmbed("ws_1");
    expect(blocked.embedUrl).toBeNull();
    expect(blocked.linkUrl).toBe("https://bi.example.org");
  });

  it("signs instance dashboards without a workspace_id and only from the admin allow-list", async () => {
    const ok = await instanceEmbed(3);
    const { payload } = await jwtVerify(tokenOf(ok.embedUrl!), new TextEncoder().encode("instance-secret-0123456789"));
    expect(payload.params).toEqual({});
    expect((await instanceEmbed(99)).selected).toBe(3);
    settings.values["obs.metabase.enabled"] = "false";
    expect((await instanceEmbed(3)).embedUrl).toBeNull();
  });
});

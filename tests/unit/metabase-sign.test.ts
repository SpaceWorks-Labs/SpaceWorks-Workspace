import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { frameAllowed } from "@/lib/observability/metabase/frame";
import { embedUrl, EmbedRefused, MAX_EMBED_TTL_SECONDS, parseDashboardIds, signDashboardToken } from "@/lib/observability/metabase/sign";

const SECRET = "metabase-secret-0123456789abcdef";
const key = new TextEncoder().encode(SECRET);

describe("metabase signing", () => {
  it("overrides a client-supplied workspace_id with the server-derived one", async () => {
    const token = await signDashboardToken({ secret: SECRET, dashboardId: 7, allowed: [7], workspaceId: "ws_server", params: { workspace_id: "ws_attacker", range: "30d" } });
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    expect(payload).toMatchObject({ resource: { dashboard: 7 }, params: { workspace_id: "ws_server", range: "30d" } });
  });

  it("drops a client workspace_id when the dashboard is instance scoped", async () => {
    const token = await signDashboardToken({ secret: SECRET, dashboardId: 1, allowed: [1], params: { workspace_id: "ws_attacker" } });
    const { payload } = await jwtVerify(token, key);
    expect(payload.params).toEqual({});
  });

  it("rejects dashboards that are not on the allow-list", async () => {
    await expect(signDashboardToken({ secret: SECRET, dashboardId: 9, allowed: [1, 2], workspaceId: "w" })).rejects.toBeInstanceOf(EmbedRefused);
    await expect(signDashboardToken({ secret: SECRET, dashboardId: 1, allowed: [], workspaceId: "w" })).rejects.toBeInstanceOf(EmbedRefused);
    await expect(signDashboardToken({ secret: "", dashboardId: 1, allowed: [1] })).rejects.toBeInstanceOf(EmbedRefused);
  });

  it("never lets exp exceed 10 minutes, whatever ttl is requested", async () => {
    const now = new Date("2026-11-12T10:00:00Z");
    const token = await signDashboardToken({ secret: SECRET, dashboardId: 1, allowed: [1], ttlSeconds: 86_400, now });
    const { payload } = await jwtVerify(token, key, { currentDate: now });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(MAX_EMBED_TTL_SECONDS);
    const short = await signDashboardToken({ secret: SECRET, dashboardId: 1, allowed: [1], now });
    expect((await jwtVerify(short, key, { currentDate: now })).payload.exp).toBeLessThanOrEqual(Math.floor(now.getTime() / 1000) + 600);
  });

  it("keeps the secret out of the token and the url", async () => {
    const token = await signDashboardToken({ secret: SECRET, dashboardId: 1, allowed: [1] });
    expect(token).not.toContain(SECRET);
    expect(embedUrl("https://bi.example.org/", token)).toBe(`https://bi.example.org/embed/dashboard/${token}#bordered=false&titled=true`);
  });

  it("parses dashboard ids defensively", () => {
    expect(parseDashboardIds("1, 2,2, x, -3, 4.5, 0")).toEqual([1, 2]);
    expect(parseDashboardIds(["5", 6])).toEqual([5, 6]);
    expect(parseDashboardIds(undefined)).toEqual([]);
  });

  it("frames only https origins listed in OBS_CSP_FRAME_ORIGINS", () => {
    const env = { OBS_CSP_FRAME_ORIGINS: "https://bi.example.org, https://other.example.org:8443" };
    expect(frameAllowed("https://bi.example.org/some/path", env)).toBe(true);
    expect(frameAllowed("https://other.example.org:8443", env)).toBe(true);
    expect(frameAllowed("https://evil.example.org", env)).toBe(false);
    expect(frameAllowed("http://bi.example.org", env)).toBe(false);
    expect(frameAllowed("https://bi.example.org", {})).toBe(false);
  });
});

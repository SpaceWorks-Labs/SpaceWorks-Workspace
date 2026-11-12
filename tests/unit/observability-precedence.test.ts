import { describe, expect, it } from "vitest";
import { checkWorkspaceHost, hostMatchesAllowlist, parseHttpsOrigin, parseLinkoutUrl } from "@/lib/observability/hosts";
import { resolveWorkspaceConnection } from "@/lib/observability/workspaceConfig";
import type { ObsSettings } from "@/lib/observability/keys";

const base = (over: Partial<ObsSettings["overrides"]> = {}): ObsSettings => ({
  sentry: { enabled: false, dsn: null, environment: "t", tracesSampleRate: 0 },
  posthog: { enabled: true, key: "phc_instancekey1234", host: "https://eu.i.posthog.com" },
  clarity: { enabled: true, projectId: "inst1234" },
  firebase: { enabled: false, measurementId: null },
  metrics: { enabled: false },
  grafana: { url: "https://grafana.instance.test", dashboardPath: null },
  metabase: { enabled: true, siteUrl: "https://mb.instance.test", secretKey: "instance-secret", adminDashboardIds: ["1"] },
  consentMode: "opt-in",
  overrides: { allowed: true, providers: ["posthog", "clarity", "grafana", "metabase"], hostAllowlist: ["ph.team.example", "*.corp.example"], ...over },
});
const row = (mode: string, publicConfig: unknown = {}, enabled = true, secretEnc: string | null = null) => ({ mode, enabled, publicConfig, secretEnc });
const own = { key: "phc_ownkey1234567", host: "https://ph.team.example" };

describe("workspace connection precedence", () => {
  it("uses the instance default with no row, inherit, or when overrides are disallowed", async () => {
    expect((await resolveWorkspaceConnection("posthog", "w", { settings: base(), row: null })).source).toBe("instance");
    expect((await resolveWorkspaceConnection("posthog", "w", { settings: base(), row: row("inherit") })).source).toBe("instance");
    const blocked = await resolveWorkspaceConnection("posthog", "w", { settings: base({ allowed: false }), row: row("off") });
    expect(blocked).toMatchObject({ source: "instance", active: true });
    const unlisted = await resolveWorkspaceConnection("posthog", "w", { settings: base({ providers: ["grafana"] }), row: row("own", own) });
    expect(unlisted.config.key).toBe("phc_instancekey1234");
  });

  it("off sends nothing", async () => {
    expect(await resolveWorkspaceConnection("posthog", "w", { settings: base(), row: row("off", {}, false) })).toMatchObject({ source: "off", active: false });
  });

  it("own replaces the instance config and is never mixed with it", async () => {
    const r = await resolveWorkspaceConnection("posthog", "w", { settings: base(), row: row("own", own) });
    expect(r).toMatchObject({ source: "workspace", active: true, config: { key: own.key, host: "https://ph.team.example" } });
  });

  it("an incomplete or invalid own config sends nothing (does not fall back)", async () => {
    for (const cfg of [{}, { key: "bad", host: own.host }, { key: own.key, host: "http://ph.team.example" }, { key: own.key, host: "https://other.example" }, { key: own.key, host: "https://127.0.0.1" }]) {
      expect(await resolveWorkspaceConnection("posthog", "w", { settings: base(), row: row("own", cfg) })).toMatchObject({ source: "off", active: false });
    }
  });

  it("linkout carries a link and never sends", async () => {
    const r = await resolveWorkspaceConnection("grafana", "w", { settings: base(), row: row("linkout", { url: "https://dash.example/x" }) });
    expect(r).toMatchObject({ source: "linkout", active: false, config: { url: "https://dash.example/x" } });
    expect((await resolveWorkspaceConnection("grafana", "w", { settings: base(), row: row("linkout", { url: "http://dash.example" }) })).source).toBe("off");
  });

  it("clarity needs the workspace owner's opt-in even when the instance enables it", async () => {
    expect((await resolveWorkspaceConnection("clarity", "w", { settings: base(), row: null })).active).toBe(false);
    expect((await resolveWorkspaceConnection("clarity", "w", { settings: base(), row: row("inherit", {}, false) })).active).toBe(false);
    expect(await resolveWorkspaceConnection("clarity", "w", { settings: base(), row: row("inherit") })).toMatchObject({ source: "instance", active: true, config: { projectId: "inst1234" } });
    expect(await resolveWorkspaceConnection("clarity", "w", { settings: base(), row: row("own", { projectId: "own5678" }) })).toMatchObject({ source: "workspace", config: { projectId: "own5678" } });
  });

  it("metabase own needs an allowed host and an embedding secret", async () => {
    const cfg = { siteUrl: "https://mb.corp.example", dashboardIds: ["5", "x"] };
    expect((await resolveWorkspaceConnection("metabase", "w", { settings: base(), row: row("own", cfg, true, null) })).source).toBe("off");
    const ok = await resolveWorkspaceConnection("metabase", "w", { settings: base(), row: row("own", cfg, true, "not-decryptable") });
    expect(ok).toMatchObject({ source: "workspace", active: true, config: { siteUrl: "https://mb.corp.example", dashboardIds: ["5"] }, secret: null });
  });
});

describe("host validation", () => {
  it("matches exact and wildcard allow-list entries; empty allows nothing", () => {
    expect(hostMatchesAllowlist("a.corp.example", ["*.corp.example"])).toBe(true);
    expect(hostMatchesAllowlist("corp.example", ["*.corp.example"])).toBe(false);
    expect(hostMatchesAllowlist("evilcorp.example", ["*.corp.example"])).toBe(false);
    expect(hostMatchesAllowlist("x.test", [])).toBe(false);
  });

  it("requires https, no credentials, no path and an allow-listed public host", async () => {
    expect(parseHttpsOrigin("http://a.test").ok).toBe(false);
    expect(parseHttpsOrigin("https://u:p@a.test").ok).toBe(false);
    expect(parseHttpsOrigin("https://a.test/path").ok).toBe(false);
    const lookup = async () => [{ address: "10.0.0.5", family: 4 }];
    expect((await checkWorkspaceHost("https://ph.team.example", ["ph.team.example"], { lookup })).ok).toBe(false);
    const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
    expect(await checkWorkspaceHost("https://ph.team.example", ["ph.team.example"], { lookup: publicLookup })).toMatchObject({ ok: true, origin: "https://ph.team.example" });
    expect((await checkWorkspaceHost("https://169.254.169.254", ["169.254.169.254"], { dns: false })).ok).toBe(false);
  });

  it("link-out accepts any https URL", () => {
    expect(parseLinkoutUrl("https://anything.example/dash?a=1").ok).toBe(true);
    expect(parseLinkoutUrl("javascript:alert(1)").ok).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ settings: null as unknown, user: null as { id: string } | null }));
vi.mock("@/lib/observability/keys", () => ({ getObsSettings: async () => state.settings }));
vi.mock("@/lib/permissions", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/db", () => ({ prisma: { membership: { findFirst: async () => ({ id: "m" }) }, workspaceAnalyticsConnection: { findUnique: async () => null } } }));

import { handleSentryTunnel, SENTRY_TUNNEL_MAX_BYTES } from "@/lib/observability/sentry/tunnel";
import { allowedPosthogPath, handlePosthogTunnel, POSTHOG_TUNNEL_MAX_BYTES } from "@/lib/observability/posthog/tunnel";
import { signObsToken } from "@/lib/observability/identity";

const DSN = "https://pubkey@o1.ingest.sentry.io/42";
const settings = (over: Record<string, unknown> = {}) => ({
  sentry: { enabled: true, dsn: DSN, environment: "t", tracesSampleRate: 0 },
  posthog: { enabled: true, key: "phc_abcdefghijk", host: "https://eu.i.posthog.com" },
  overrides: { allowed: false, providers: [], hostAllowlist: [] },
  ...over,
});
const envelope = (dsn: string) => `${JSON.stringify({ dsn })}\n{"type":"event"}\n{}`;
const post = (body: string | Uint8Array, headers: Record<string, string> = {}) => new Request("http://app.test/api/obs/sentry", { method: "POST", body: body as BodyInit, headers });

beforeEach(() => { state.settings = settings(); state.user = { id: "u1" }; });

describe("sentry tunnel", () => {
  it("returns 404 when disabled or without a DSN", async () => {
    state.settings = settings({ sentry: { enabled: false, dsn: DSN, environment: "t", tracesSampleRate: 0 } });
    expect((await handleSentryTunnel(post(envelope(DSN)))).status).toBe(404);
    state.settings = settings({ sentry: { enabled: true, dsn: null, environment: "t", tracesSampleRate: 0 } });
    expect((await handleSentryTunnel(post(envelope(DSN)))).status).toBe(404);
  });

  it("caps the body size", async () => {
    const res = await handleSentryTunnel(post(new Uint8Array(SENTRY_TUNNEL_MAX_BYTES + 1)));
    expect(res.status).toBe(413);
  });

  it("rejects an envelope for another DSN and never forwards it", async () => {
    const fetchMock = vi.fn();
    const res = await handleSentryTunnel(post(envelope("https://pubkey@evil.example/42")), fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(403);
    expect((await handleSentryTunnel(post("not json"), fetchMock as unknown as typeof fetch)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only to the configured DSN host without following redirects", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const res = await handleSentryTunnel(post(envelope(DSN)), fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).host).toBe("o1.ingest.sentry.io");
    expect(url).toContain("/api/42/envelope/");
    expect(init.redirect).toBe("manual");
  });
});

describe("posthog tunnel paths", () => {
  it("allows only the whitelist", () => {
    expect(allowedPosthogPath(["e"])).toBe("/e");
    expect(allowedPosthogPath(["e", ""])).toBeNull();
    expect(allowedPosthogPath(["capture"])).toBe("/capture");
    expect(allowedPosthogPath(["static", "array.js"])).toBe("/static/array.js");
    for (const bad of [["static", ".."], ["..", "e"], ["admin"], ["api", "projects"], ["static", "a%2e%2e"], ["static", "a", "b"], []]) expect(allowedPosthogPath(bad)).toBeNull();
  });
});

describe("posthog tunnel", () => {
  const call = (path: string[], init: RequestInit = {}, fetchImpl?: typeof fetch) =>
    handlePosthogTunnel(new Request("http://app.test/api/obs/ph/" + path.join("/") + "?ip=0&evil=1", { method: "POST", body: "x", ...init }), path, fetchImpl);

  it("is 404 when signed out, disabled or the path is not allowed", async () => {
    state.user = null;
    expect((await call(["e"])).status).toBe(404);
    state.user = { id: "u1" };
    state.settings = settings({ posthog: { enabled: false, key: "k", host: "https://eu.i.posthog.com" } });
    expect((await call(["e"])).status).toBe(404);
    state.settings = settings();
    expect((await call(["admin"])).status).toBe(404);
  });

  it("rejects a token that belongs to another user", async () => {
    const token = signObsToken({ w: "w1", u: "someone-else" });
    expect((await call(["e"], { headers: { "x-sww-obs": token } })).status).toBe(404);
  });

  it("caps the body, forwards to the instance host with a filtered query and no cookies", async () => {
    expect((await call(["e"], { body: new Uint8Array(POSTHOG_TUNNEL_MAX_BYTES + 1) as BodyInit })).status).toBe(413);
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    const res = await call(["e"], { headers: { cookie: "sid=1", "content-type": "text/plain" } }, fetchMock as unknown as typeof fetch);
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://eu.i.posthog.com/e?ip=0");
    expect(init.headers).toEqual({ "content-type": "text/plain" });
    expect(init.redirect).toBe("manual");
  });

  it("does not pass redirects through", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.test" } }));
    expect((await call(["e"], {}, fetchMock as unknown as typeof fetch)).status).toBe(502);
  });
});

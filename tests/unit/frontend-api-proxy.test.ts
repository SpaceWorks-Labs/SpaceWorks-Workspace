import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("@/lib/frontend/request", () => ({ backendHeaders: mocks.headers, backendUrl: (path: string) => new URL(path, "https://api.example.test") }));
import { proxyBackendApi, proxyBackendResource } from "@/lib/frontend/httpProxy";

beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://workspace.example.test"); vi.stubEnv("BACKEND_ORIGIN", "https://api.example.test"); mocks.headers.mockReset().mockResolvedValue(new Headers({ "x-sww-frontend-key": "test-peer" })); });

describe("frontend API proxy", () => {
  it("never gives browser calls access to private peer or operational endpoints", async () => {
    for (const path of ["frontend/view/private", "%66rontend/action/private", "%2566rontend/action/private", "FRONTEND/action/private", "internal/outbox", "health/db", "x%2f..%2ffrontend/view/private"]) {
      expect((await proxyBackendApi(new Request(`https://workspace.example.test/api/${path}`))).status).toBe(404);
    }
    expect(mocks.headers).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes before forwarding any cookies", async () => {
    const response = await proxyBackendApi(new Request("https://workspace.example.test/api/rsvp", { method: "POST", headers: { origin: "https://attacker.example.test", cookie: "session=value" } }));
    expect(response.status).toBe(404); expect(mocks.headers).not.toHaveBeenCalled();
  });
  it("preserves multiple host-only auth cookies and redirects to the frontend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: [["set-cookie", "csrf=one; Path=/; HttpOnly; Secure; SameSite=Lax"], ["set-cookie", "session=two; Path=/; HttpOnly; Secure; SameSite=Lax"], ["location", "https://api.example.test/account"]] }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await proxyBackendApi(new Request("https://workspace.example.test/api/auth/session", { headers: { "x-forwarded-for": "spoofed", "x-sww-frontend-key": "spoofed" } }));
      expect(response.headers.getSetCookie()).toHaveLength(2);
      expect(response.headers.get("location")).toBe("https://workspace.example.test/account");
      const forwarded = fetchMock.mock.calls[0][1].headers as Headers;
      expect(forwarded.has("x-forwarded-for")).toBe(false); expect(forwarded.get("x-sww-frontend-key")).toBe("test-peer");
    } finally { vi.unstubAllGlobals(); }
  });
  it("preserves provider signatures and MCP challenges without browser Origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401, headers: { "www-authenticate": "Bearer realm=space-works" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await proxyBackendApi(new Request("https://workspace.example.test/api/integrations/github/webhook", { method: "POST", headers: { "x-hub-signature-256": "sha256=fixture", "x-github-event": "issues", "x-github-delivery": "delivery-1" }, body: "{}" }));
      expect(response.status).toBe(401);
      expect((fetchMock.mock.calls[0][1].headers as Headers).get("x-hub-signature-256")).toBe("sha256=fixture");
      expect(response.headers.get("www-authenticate")).toBe("Bearer realm=space-works");
    } finally { vi.unstubAllGlobals(); }
  });
  it("proxies only exact non-API resources and retains private-file CSP", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("file", { headers: { "content-security-policy": "sandbox" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect((await proxyBackendResource(new Request("https://workspace.example.test/w/makers/docs/doc-1/export"))).headers.get("content-security-policy")).toBe("sandbox");
      expect((await proxyBackendResource(new Request("https://workspace.example.test/blog/makers/rssXxml"))).status).toBe(404);
      expect((await proxyBackendResource(new Request("https://workspace.example.test/admin"))).status).toBe(404);
    } finally { vi.unstubAllGlobals(); }
  });
  it.each(["files/upload", "docs/doc-1/presence"])("preserves the browser mutation header for %s", async (resource) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await proxyBackendResource(new Request(`https://workspace.example.test/w/makers/${resource}`, {
        method: "POST", headers: { origin: "https://workspace.example.test", "x-sw-client": "1", "content-type": "application/json" }, body: "{}",
      }));
      expect(response.status).toBe(200);
      expect((fetchMock.mock.calls[0][1].headers as Headers).get("x-sw-client")).toBe("1");
      expect(await new Response(fetchMock.mock.calls[0][1].body).text()).toBe("{}");
    } finally { vi.unstubAllGlobals(); }
  });

});

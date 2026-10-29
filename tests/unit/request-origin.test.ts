import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasAllowedRequestOrigin } from "@/lib/requestOrigin";
import { isSameOriginJsonRequest } from "@/lib/assistant/http";
import { isTrustedMutation } from "@/lib/files/request";

vi.mock("@/lib/permissions", () => ({ findWorkspaceForUser: vi.fn(), getCurrentUser: vi.fn() }));
const secret = "a".repeat(64);
const frontend = "https://workspace.example.test";
function request(headers: Record<string, string> = {}) {
  return new Request("https://api.example.test/w/makers/files/upload", { method: "POST", headers });
}
const invalidDirectOrigins: Record<string, string>[] = [
  { host: "api.example.test", origin: frontend },
  { host: "workspace.example.test", origin: "https://attacker.example.test" },
  { host: "workspace.example.test", origin: "invalid origin" },
  { origin: frontend },
];
beforeEach(() => {
  vi.stubEnv("FRONTEND_GATEWAY_SECRET", secret);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", frontend);
});
afterEach(() => vi.unstubAllEnvs());

describe("browser mutation origins", () => {
  it("retains direct same-host and custom-header non-browser requests", () => {
    expect(hasAllowedRequestOrigin(request({ host: "workspace.example.test", origin: frontend }))).toBe(true);
    expect(isTrustedMutation(request({ "x-sw-client": "1" }))).toBe(true);
  });
  it.each(invalidDirectOrigins)("rejects mismatched or invalid direct origins: %j", headers => {
    expect(hasAllowedRequestOrigin(request(headers))).toBe(false);
  });
  it("accepts only the canonical frontend origin from an authenticated peer", () => {
    const headers = { "x-sww-frontend-key": secret, origin: frontend, host: "api.example.test", "x-forwarded-host": "api.example.test", "x-sw-client": "1", "content-type": "application/json" };
    expect(isTrustedMutation(request(headers))).toBe(true);
    expect(isSameOriginJsonRequest(request(headers))).toBe(true);
  });
  it.each([undefined, "https://api.example.test", "https://attacker.example.test", "http://workspace.example.test"])("rejects peer origin %s despite matching forwarded host", origin => {
    expect(hasAllowedRequestOrigin(request({ "x-sww-frontend-key": secret, "x-forwarded-host": "attacker.example.test", ...(origin ? { origin } : {}) }))).toBe(false);
  });
  it("rejects forged peers and peers without a configured secret", () => {
    const headers = { "x-sww-frontend-key": "forged", origin: frontend, "x-forwarded-host": "workspace.example.test" };
    expect(hasAllowedRequestOrigin(request(headers))).toBe(false);
    vi.stubEnv("FRONTEND_GATEWAY_SECRET", "");
    expect(hasAllowedRequestOrigin(request({ ...headers, "x-sww-frontend-key": secret }))).toBe(false);
  });
  it("keeps custom-client, JSON and fetch-site requirements on the authenticated path", () => {
    const headers = { "x-sww-frontend-key": secret, origin: frontend };
    expect(isTrustedMutation(request(headers))).toBe(false);
    expect(isSameOriginJsonRequest(request(headers))).toBe(false);
    expect(isSameOriginJsonRequest(request({ ...headers, "content-type": "application/json", "sec-fetch-site": "cross-site" }))).toBe(false);
  });
});

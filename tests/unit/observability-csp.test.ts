import { afterEach, describe, expect, it, vi } from "vitest";
import { observabilityCspSources, parseOrigins } from "@/lib/observability/csp";
import { buildContentSecurityPolicy } from "@/lib/pageSecurity";

afterEach(() => vi.unstubAllEnvs());

describe("observability CSP", () => {
  it("adds nothing with an empty env, so the policy is unchanged", () => {
    expect(observabilityCspSources({})).toEqual({ connect: [], frame: [] });
    const csp = buildContentSecurityPolicy("n0nce", true);
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toContain("frame-src");
  });

  it("expands providers and explicit origins without touching script-src", () => {
    vi.stubEnv("OBS_CSP_PROVIDERS", "clarity,firebase,posthog");
    vi.stubEnv("OBS_CSP_FRAME_ORIGINS", "https://metabase.example.org");
    const csp = buildContentSecurityPolicy("n0nce", true);
    expect(csp).toContain("https://*.clarity.ms");
    expect(csp).toContain("https://www.googletagmanager.com");
    expect(csp).toContain("frame-src 'self' https://metabase.example.org;");
    expect(csp).toContain("script-src 'self' 'nonce-n0nce' 'strict-dynamic';");
    expect(csp).not.toMatch(/script-src[^;]*(clarity|google)/);
  });

  it("rejects wildcards, http, paths and credentials", () => {
    expect(parseOrigins("https://*.evil.test, http://a.test, https://a.test/path, https://u:p@a.test, https://ok.test:8443, *")).toEqual(["https://ok.test:8443"]);
    vi.stubEnv("OBS_CSP_PROVIDERS", "bogus");
    expect(observabilityCspSources()).toEqual({ connect: [], frame: [] });
  });
});

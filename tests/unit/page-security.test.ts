import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "@/lib/pageSecurity";

describe("content security policy", () => {
  it("keeps the nonce and strict-dynamic, and adds only the sign-in provider form actions when other extras are empty", () => {
    const csp = buildContentSecurityPolicy("abc123", true);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("form-action 'self' https://accounts.google.com https://github.com https://appleid.apple.com;");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toContain("frame-src");
    expect(csp).toBe([
      "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
      "form-action 'self' https://accounts.google.com https://github.com https://appleid.apple.com", "img-src 'self' data: blob: https:", "font-src 'self' data:",
      "connect-src 'self'", "script-src 'self' 'nonce-abc123' 'strict-dynamic'", "style-src 'self' 'unsafe-inline'", "upgrade-insecure-requests",
    ].join("; "));
  });
});

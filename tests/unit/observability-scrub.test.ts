import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubEvent, scrubUrl } from "@/lib/observability/sentry/scrub";
import { sanitizePosthogProperties } from "@/lib/observability/posthog/sanitize";
import { normalizePath } from "@/lib/observability/routes";

describe("sentry scrubbing", () => {
  it("strips cookies, headers, bodies, queries, users and tokens", () => {
    const event = scrubEvent({
      request: { url: "https://app.example.org/w/acme/projects/ck1234567890abcdef/edit?token=abc#x", cookies: { a: "b" }, headers: { authorization: "Bearer x" }, data: { password: "p" }, query_string: "token=1" },
      user: { email: "a@b.co", id: "u1" },
      message: "Failed for jane@example.org at https://x.test/reset?t=1",
      exception: { values: [{ type: "Error", value: "Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCD leaked" }] },
      extra: { secret: "x" },
    });
    expect(event.request).toEqual({ url: "/w/:workspace/projects/:id/edit" });
    expect(event).not.toHaveProperty("user");
    expect(event).not.toHaveProperty("extra");
    expect(event.message).toBe("Failed for [redacted email] at [redacted URL]");
    expect(JSON.stringify(event.exception)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("drops console and ui breadcrumbs and keeps only templated request data", () => {
    expect(scrubBreadcrumb({ category: "console", message: "hi" })).toBeNull();
    expect(scrubBreadcrumb({ category: "ui.click", message: "button" })).toBeNull();
    const crumb = scrubBreadcrumb({ category: "fetch", data: { url: "https://h.test/api/x?token=1", method: "POST", status_code: 500, request_body: "secret" } })!;
    expect(crumb.data).toEqual({ url: "/api/:id", method: "POST", status_code: 500 });
  });

  it("templates paths", () => {
    expect(scrubUrl("https://x.test/w/acme/docs/abc123?q=1")).toBe("/w/:workspace/docs/:id");
    expect(normalizePath("/w/acme")).toBe("/w/:workspace");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("posthog property sanitizer", () => {
  it("keeps a templated path and drops urls, referrers, hosts and titles", () => {
    const out = sanitizePosthogProperties({ $current_url: "https://app.test/w/acme/projects/ckabc?x=1#h", $referrer: "https://evil.test/?e=a@b.co", $host: "app.test", $title: "Jane's board", $browser: "Chrome" });
    expect(out).toEqual({ $current_url: "/w/:workspace/projects/:id", $pathname: "/w/:workspace/projects/:id", $browser: "Chrome" });
  });
});

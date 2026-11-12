import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

describe("campaign security helpers", () => {
  it("reads the bounce secret from the header or Basic auth, never the URL", async () => {
    const { readWebhookSecret } = await import("@/lib/campaigns/bounce/webhook");
    expect(readWebhookSecret(new Request("http://x/h?secret=abc"))).toBeNull();
    expect(readWebhookSecret(new Request("http://x/h", { headers: { "x-webhook-secret": "abc" } }))).toBe("abc");
    expect(readWebhookSecret(new Request("http://x/h", { headers: { authorization: `Basic ${Buffer.from("u:p:w").toString("base64")}` } }))).toBe("p:w");
  });

  it("renders the confirmation email from the outbox row at send time and expires it", async () => {
    const { renderOutboxMessage } = await import("@/lib/outbox");
    const payload = { to: "a@b.test", workspaceName: "W", listName: "News", confirmUrl: "https://x.test/m/confirm/t", expiresAt: new Date(Date.now() + 1000).toISOString() };
    const out = renderOutboxMessage("campaign.confirm", payload);
    expect(out).not.toBe("expired");
    expect(out !== "expired" && out.email.text).toContain("https://x.test/m/confirm/t");
    expect(renderOutboxMessage("campaign.confirm", { ...payload, expiresAt: new Date(0).toISOString() })).toBe("expired");
    expect(() => renderOutboxMessage("campaign.confirm", { ...payload, confirmUrl: "javascript:1" })).toThrow();
  });
});

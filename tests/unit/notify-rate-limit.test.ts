import { describe, expect, it } from "vitest";
import { consumeOutboundToken, limitFor, OUTBOUND_PER_MINUTE, takeFromBucket } from "@/lib/notify/rateLimit";

describe("outbound token bucket", () => {
  it("allows a full burst, then refuses with the wait until the next token", () => {
    let state = undefined as ReturnType<typeof takeFromBucket>["state"] | undefined;
    for (let i = 0; i < 20; i++) {
      const step = takeFromBucket(state, 1000, 20);
      expect(step.allowed).toBe(true);
      state = step.state;
    }
    const refused = takeFromBucket(state, 1000, 20);
    expect(refused.allowed).toBe(false);
    expect(refused.waitMs).toBe(3000);
  });

  it("refills over time up to capacity", () => {
    const empty = { tokens: 0, at: 0 };
    expect(takeFromBucket(empty, 3000, 20).allowed).toBe(true);
    expect(takeFromBucket(empty, 1000, 20).allowed).toBe(false);
    expect(takeFromBucket({ tokens: 0, at: 0 }, 10 * 60_000, 20).state.tokens).toBe(19);
  });

  it("has channel defaults and an unknown-channel fallback", () => {
    expect(OUTBOUND_PER_MINUTE).toMatchObject({ TELEGRAM: 20, WHATSAPP: 30, DISCORD: 25, SLACK: 50, MATTERMOST: 60, WEBHOOK: 60, EMAIL: 120 });
    expect(limitFor("SOMETHING_NEW")).toBe(60);
  });

  it("limits per key in memory when Redis is not configured", async () => {
    const key = `unit:${Math.random()}`;
    const now = Date.now();
    for (let i = 0; i < 3; i++) expect((await consumeOutboundToken(key, 3, now)).allowed).toBe(true);
    const refused = await consumeOutboundToken(key, 3, now);
    expect(refused.allowed).toBe(false);
    expect(refused.waitMs).toBeGreaterThan(0);
    expect((await consumeOutboundToken(`${key}:other`, 3, now)).allowed).toBe(true);
  });
});

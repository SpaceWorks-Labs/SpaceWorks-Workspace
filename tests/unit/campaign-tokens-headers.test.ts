import { describe, expect, it } from "vitest";
import { signCampaignToken, verifyCampaignToken } from "@/lib/campaigns/tokens";
import { campaignHeaders } from "@/lib/campaigns/headers";

describe("campaign tokens", () => {
  const base = { workspaceId: "ws1", messageId: "m1", subscriberId: "s1" };

  it("round-trips and keeps the workspace", () => {
    const token = signCampaignToken({ purpose: "unsub", ...base });
    expect(verifyCampaignToken(token, "unsub")).toMatchObject(base);
  });
  it("rejects another purpose", () => {
    expect(verifyCampaignToken(signCampaignToken({ purpose: "unsub", ...base }), "click")).toBeNull();
  });
  it("rejects a tampered payload or signature", () => {
    const [payload, sig] = signCampaignToken({ purpose: "open", ...base }).split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ purpose: "open", workspaceId: "ws2", messageId: "m1" })).toString("base64url");
    expect(verifyCampaignToken(`${forged}.${sig}`, "open")).toBeNull();
    expect(verifyCampaignToken(`${payload}.${sig.replace(/.$/, (c) => (c === "0" ? "1" : "0"))}`, "open")).toBeNull();
    expect(verifyCampaignToken("garbage", "open")).toBeNull();
    expect(verifyCampaignToken(`${payload}.`, "open")).toBeNull();
  });
  it("confirm tokens expire after 72 hours, unsubscribe tokens never", () => {
    const now = Date.now();
    const confirm = signCampaignToken({ purpose: "confirm", ...base }, now);
    expect(verifyCampaignToken(confirm, "confirm", now + 71 * 3_600_000)).not.toBeNull();
    expect(verifyCampaignToken(confirm, "confirm", now + 73 * 3_600_000)).toBeNull();
    const unsub = signCampaignToken({ purpose: "unsub", ...base, exp: now + 1 }, now);
    expect(verifyCampaignToken(unsub, "unsub", now + 10 * 365 * 86_400_000)).not.toBeNull();
  });
});

describe("campaign headers", () => {
  it("builds bulk headers with a deterministic Message-ID", () => {
    const h = campaignHeaders({ unsubscribeUrl: "https://x.test/u/t", messageId: "abc", domain: "mail.test", ref: "ref1" });
    expect(h["List-Unsubscribe"]).toBe("<https://x.test/u/t>");
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(h["Message-ID"]).toBe("<c-abc@mail.test>");
    expect(h.Precedence).toBe("bulk");
    expect(h["X-Campaign-Ref"]).toBe("ref1");
  });
  it("strips line breaks and angle brackets", () => {
    const h = campaignHeaders({ unsubscribeUrl: "https://x.test/\r\nBcc: a@b.c", messageId: "a>b", domain: "d\n.test", ref: "r\r\n" });
    expect(Object.values(h).join("")).not.toMatch(/[\r\n]/);
  });
});

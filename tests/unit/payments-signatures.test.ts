import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyRazorpaySignature, verifyStripeSignature } from "@/lib/payments/signatures";

const secret = "whsec_test_secret_value";
const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
const now = 1_800_000_000_000;
const ts = String(Math.floor(now / 1000));
const sign = (key: string, payload: string) => createHmac("sha256", key).update(payload).digest("hex");
const header = (t = ts, sig = sign(secret, `${t}.${body}`)) => `t=${t},v1=${sig}`;

describe("Stripe signature", () => {
  it("accepts a valid signature", () => expect(verifyStripeSignature(secret, body, header(), now)).toBe(true));
  it("accepts when one of several v1 values matches", () => expect(verifyStripeSignature(secret, body, `t=${ts},v1=${"0".repeat(64)},v1=${sign(secret, `${ts}.${body}`)}`, now)).toBe(true));
  it("rejects a tampered body", () => expect(verifyStripeSignature(secret, `${body} `, header(), now)).toBe(false));
  it("rejects the wrong secret", () => expect(verifyStripeSignature("whsec_other_secret", body, header(), now)).toBe(false));
  it("rejects a stale timestamp", () => {
    const old = String(Math.floor(now / 1000) - 301);
    expect(verifyStripeSignature(secret, body, header(old), now)).toBe(false);
    expect(verifyStripeSignature(secret, body, header(String(Math.floor(now / 1000) - 299)), now)).toBe(true);
  });
  it("rejects a timestamp from the future beyond tolerance", () => expect(verifyStripeSignature(secret, body, header(String(Math.floor(now / 1000) + 400)), now)).toBe(false));
  it("rejects missing and malformed headers", () => {
    for (const bad of [null, "", "garbage", `t=${ts}`, `v1=${sign(secret, `${ts}.${body}`)}`, `t=abc,v1=${"a".repeat(64)}`, `t=${ts},v1=short`, `t=${ts},v1=${"z".repeat(64)}`]) {
      expect(verifyStripeSignature(secret, body, bad, now)).toBe(false);
    }
  });
  it("rejects an empty secret", () => expect(verifyStripeSignature("", body, header("", ""), now)).toBe(false));
});

describe("Razorpay signature", () => {
  const rz = "razorpay-webhook-secret";
  it("accepts a valid signature", () => expect(verifyRazorpaySignature(rz, body, sign(rz, body))).toBe(true));
  it("accepts upper-case hex", () => expect(verifyRazorpaySignature(rz, body, sign(rz, body).toUpperCase())).toBe(true));
  it("rejects a tampered body", () => expect(verifyRazorpaySignature(rz, `${body}x`, sign(rz, body))).toBe(false));
  it("rejects the wrong secret", () => expect(verifyRazorpaySignature("nope-nope", body, sign(rz, body))).toBe(false));
  it("rejects missing and malformed headers", () => {
    for (const bad of [null, "", "abc", "g".repeat(64), `${sign(rz, body)}00`]) expect(verifyRazorpaySignature(rz, body, bad)).toBe(false);
  });
  it("rejects an empty secret", () => expect(verifyRazorpaySignature("", body, sign("", body))).toBe(false));
});

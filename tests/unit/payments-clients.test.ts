import { afterEach, describe, expect, it, vi } from "vitest";
import { createRazorpayLink, verifyRazorpay } from "@/lib/payments/razorpay";
import { createStripeCheckout, refundStripe, STRIPE_API_VERSION, verifyStripe } from "@/lib/payments/stripe";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const stripeKeys = { secretKey: "sk_test_abcdefgh1234", webhookSecret: "" };
const rzKeys = { keyId: "rzp_test_abc123", keySecret: "secretsecret", webhookSecret: "" };

afterEach(() => vi.unstubAllGlobals());

describe("payment provider clients (mocked fetch)", () => {
  it("creates a Stripe Checkout Session with a pinned version and reference", async () => {
    const fetchMock = vi.fn(async () => json({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createStripeCheckout(stripeKeys, { paymentId: "pay1", amountMinor: 5000, currency: "INR", description: "Invoice INV-0001", customerEmail: "a@b.test", returnUrl: "https://app.test", expiresAt: 1_900_000_000 });
    expect(result).toEqual({ ok: true, data: { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect((init.headers as Record<string, string>)["Stripe-Version"]).toBe(STRIPE_API_VERSION);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_abcdefgh1234");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("client_reference_id")).toBe("pay1");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("5000");
    expect(form.get("line_items[0][price_data][currency]")).toBe("inr");
  });

  it("surfaces a Stripe error without the key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { message: "Invalid API Key provided" } }, 401)));
    const result = await verifyStripe(stripeKeys);
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.error).toContain("401"); expect(result.error).not.toContain("sk_test"); }
  });

  it("refunds with an idempotency key", async () => {
    const fetchMock = vi.fn(async () => json({ id: "re_1" }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await refundStripe(stripeKeys, { paymentIntentId: "pi_1", amountMinor: 100, idempotencyKey: "k1" })).ok).toBe(true);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
  });

  it("creates a Razorpay link (INR only) with basic auth", async () => {
    const fetchMock = vi.fn(async () => json({ id: "plink_1", short_url: "https://rzp.io/i/abc" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await createRazorpayLink(rzKeys, { paymentId: "pay1", amountMinor: 5000, currency: "USD", description: "x", customerEmail: null, expireBy: 1 })).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    const ok = await createRazorpayLink(rzKeys, { paymentId: "pay1", amountMinor: 5000, currency: "INR", description: "x", customerEmail: null, expireBy: 1_900_000_000 });
    expect(ok).toEqual({ ok: true, data: { id: "plink_1", url: "https://rzp.io/i/abc" } });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("rzp_test_abc123:secretsecret").toString("base64")}`);
    expect(JSON.parse(String(init.body))).toMatchObject({ amount: 5000, currency: "INR", reference_id: "pay1" });
  });

  it("verifies Razorpay with a read call and rejects non-https links", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ items: [] })));
    expect((await verifyRazorpay(rzKeys)).ok).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "plink_1", short_url: "http://evil.test" })));
    expect((await createRazorpayLink(rzKeys, { paymentId: "p", amountMinor: 1, currency: "INR", description: "x", customerEmail: null, expireBy: 1 })).ok).toBe(false);
  });
});

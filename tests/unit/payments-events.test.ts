import { describe, expect, it } from "vitest";
import { parseRazorpayEvent, parseStripeEvent } from "@/lib/payments/events";

const session = (extra: Record<string, unknown> = {}) => ({ id: "cs_1", client_reference_id: "pay1", payment_intent: "pi_1", amount_total: 5000, currency: "inr", payment_status: "paid", ...extra });
const stripe = (type: string, object: unknown, id = "evt_1") => ({ id, type, data: { object } });

describe("Stripe events", () => {
  it("maps a paid checkout session", () => {
    expect(parseStripeEvent(stripe("checkout.session.completed", session()))).toMatchObject({ eventId: "evt_1", kind: "paid", paymentRef: "pay1", linkId: "cs_1", externalPaymentId: "pi_1", amountMinor: 5000, currency: "INR" });
  });
  it("waits for async methods before marking paid", () => {
    expect(parseStripeEvent(stripe("checkout.session.completed", session({ payment_status: "unpaid" })))).toBeNull();
    expect(parseStripeEvent(stripe("checkout.session.async_payment_succeeded", session({ payment_status: "unpaid" })))?.kind).toBe("paid");
    expect(parseStripeEvent(stripe("checkout.session.async_payment_failed", session()))?.kind).toBe("failed");
    expect(parseStripeEvent(stripe("checkout.session.expired", session()))?.kind).toBe("expired");
  });
  it("maps a charge refund with the cumulative amount", () => {
    expect(parseStripeEvent(stripe("charge.refunded", { payment_intent: "pi_1", amount: 5000, amount_refunded: 2000, currency: "inr" }))).toMatchObject({ kind: "refunded", externalPaymentId: "pi_1", refundedMinor: 2000 });
  });
  it("ignores other event types and garbage", () => {
    expect(parseStripeEvent(stripe("customer.created", {}))).toBeNull();
    expect(parseStripeEvent(null)).toBeNull();
    expect(parseStripeEvent({ type: "x" })).toBeNull();
  });
});

describe("Razorpay events", () => {
  const paid = { event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_1", reference_id: "pay1", currency: "INR", amount_paid: 5000 } }, payment: { entity: { id: "pay_rz1", amount: 5000, currency: "INR" } } } };
  it("maps a paid link", () => {
    expect(parseRazorpayEvent(paid, "evt-h-1", "{}")).toMatchObject({ eventId: "evt-h-1", kind: "paid", paymentRef: "pay1", linkId: "plink_1", externalPaymentId: "pay_rz1", amountMinor: 5000, currency: "INR" });
  });
  it("derives a stable id from the body when the header is absent", () => {
    expect(parseRazorpayEvent(paid, null, "abc")?.eventId).toBe(parseRazorpayEvent(paid, null, "abc")?.eventId);
    expect(parseRazorpayEvent(paid, null, "abc")?.eventId).not.toBe(parseRazorpayEvent(paid, null, "abd")?.eventId);
  });
  it("maps expiry and refunds, ignores the rest", () => {
    expect(parseRazorpayEvent({ event: "payment_link.expired", payload: paid.payload }, "e", "{}")?.kind).toBe("expired");
    expect(parseRazorpayEvent({ event: "refund.processed", payload: { refund: { entity: { payment_id: "pay_rz1", amount: 1000 } }, payment: { entity: { id: "pay_rz1", amount: 5000, amount_refunded: 1000 } } } }, "e", "{}")).toMatchObject({ kind: "refunded", externalPaymentId: "pay_rz1", refundedMinor: 1000 });
    expect(parseRazorpayEvent({ event: "payment.failed", payload: {} }, "e", "{}")).toBeNull();
    expect(parseRazorpayEvent({}, "e", "{}")).toBeNull();
  });
});

describe("invoice email pay link", async () => {
  const { renderInvoiceEmail } = await import("@/lib/finance/service/invoice-email");
  const invoice = { number: "INV-1", clientName: "A", issuedOn: new Date("2026-10-01"), dueOn: null, currency: "INR", items: [{ description: "x", quantity: 1, unitMinor: 100 }], totalMinor: 100, notes: null, workspaceName: "W", timeZone: "UTC" };
  it("renders an https link in both parts and omits other schemes", () => {
    const withLink = renderInvoiceEmail({ ...invoice, payUrl: "https://checkout.stripe.com/c/pay/cs_1" });
    expect(withLink.html).toContain("https://checkout.stripe.com/c/pay/cs_1");
    expect(withLink.text).toContain("Pay online: https://checkout.stripe.com/c/pay/cs_1");
    expect(renderInvoiceEmail({ ...invoice, payUrl: "javascript:alert(1)" }).html).not.toContain("javascript:");
    expect(renderInvoiceEmail(invoice).text).not.toContain("Pay online");
  });
});

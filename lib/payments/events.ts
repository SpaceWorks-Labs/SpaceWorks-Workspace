import { createHash } from "node:crypto";

/** Provider webhook payloads normalised to the few facts settlement needs. Unknown or irrelevant events become null (acknowledged, no action). */
export type PaymentEvent = {
  eventId: string;
  kind: "paid" | "failed" | "expired" | "refunded";
  /** Our InvoicePayment id, echoed back by the provider. */
  paymentRef: string | null;
  linkId: string | null;
  externalPaymentId: string | null;
  amountMinor: number | null;
  currency: string | null;
  /** Cumulative refunded amount reported by the provider. */
  refundedMinor: number | null;
  reason?: string;
};

const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const str = (value: unknown, max = 200) => (typeof value === "string" && value.length > 0 ? value.slice(0, max) : null);
const int = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);
const cur = (value: unknown) => (typeof value === "string" && /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : null);

export function parseStripeEvent(raw: unknown): PaymentEvent | null {
  const event = obj(raw);
  const eventId = str(event.id);
  const type = str(event.type, 80);
  const object = obj(obj(event.data).object);
  if (!eventId || !type) return null;
  const base = { eventId, paymentRef: null, linkId: null, externalPaymentId: null, amountMinor: null, currency: null, refundedMinor: null };
  if (type.startsWith("checkout.session.")) {
    const session = { ...base, paymentRef: str(object.client_reference_id) ?? str(obj(object.metadata).invoicePaymentId), linkId: str(object.id), externalPaymentId: str(object.payment_intent), amountMinor: int(object.amount_total), currency: cur(object.currency) };
    if (type === "checkout.session.completed") return object.payment_status === "paid" ? { ...session, kind: "paid" } : null;
    if (type === "checkout.session.async_payment_succeeded") return { ...session, kind: "paid" };
    if (type === "checkout.session.async_payment_failed") return { ...session, kind: "failed", reason: "The payment was declined." };
    if (type === "checkout.session.expired") return { ...session, kind: "expired" };
    return null;
  }
  if (type === "charge.refunded") {
    return { ...base, kind: "refunded", externalPaymentId: str(object.payment_intent), amountMinor: int(object.amount), currency: cur(object.currency), refundedMinor: int(object.amount_refunded) };
  }
  return null;
}

export function parseRazorpayEvent(raw: unknown, headerEventId: string | null, rawBody: string): PaymentEvent | null {
  const event = obj(raw);
  const type = str(event.event, 80);
  const payload = obj(event.payload);
  if (!type) return null;
  const eventId = str(headerEventId, 128) ?? `rzp:${createHash("sha256").update(rawBody).digest("hex")}`;
  const link = obj(obj(payload.payment_link).entity);
  const payment = obj(obj(payload.payment).entity);
  const base = { eventId, paymentRef: str(link.reference_id) ?? str(obj(link.notes).invoicePaymentId), linkId: str(link.id), externalPaymentId: str(payment.id), amountMinor: int(payment.amount) ?? int(link.amount_paid), currency: cur(payment.currency) ?? cur(link.currency), refundedMinor: null };
  if (type === "payment_link.paid") return { ...base, kind: "paid" };
  if (type === "payment_link.expired" || type === "payment_link.cancelled") return { ...base, kind: "expired" };
  if (type === "refund.processed") {
    const refund = obj(obj(payload.refund).entity);
    return { ...base, kind: "refunded", paymentRef: null, linkId: null, externalPaymentId: str(refund.payment_id) ?? str(payment.id), amountMinor: int(payment.amount), refundedMinor: int(payment.amount_refunded) ?? int(refund.amount) };
  }
  return null;
}

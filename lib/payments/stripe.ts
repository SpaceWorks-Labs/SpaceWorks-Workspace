import "server-only";
import { providerReason, requestJson } from "@/lib/integrations/http";
import type { StripeCredentials } from "./credentials";

/** Plain-fetch Stripe client (no SDK). The API version is pinned, so a Stripe-side default change never alters payloads. */
export const STRIPE_API_VERSION = "2025-09-30.clover";
const BASE = "https://api.stripe.com";

export type ProviderResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call(credentials: StripeCredentials, path: string, options: { method?: string; form?: URLSearchParams; idempotencyKey?: string } = {}): Promise<ProviderResult<Record<string, unknown>>> {
  const outcome = await requestJson<Record<string, unknown>>(`${BASE}${path}`, {
    method: options.method ?? (options.form ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${credentials.secretKey}`, "Stripe-Version": STRIPE_API_VERSION, ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}) },
    body: options.form,
    label: "Stripe",
  });
  if (outcome.ok) return { ok: true, data: outcome.data && typeof outcome.data === "object" ? outcome.data : {} };
  const reason = providerReason(outcome.data);
  return { ok: false, error: reason ? `${outcome.error} ${reason}` : outcome.error };
}

export const verifyStripe = (credentials: StripeCredentials) => call(credentials, "/v1/balance");

export async function createStripeCheckout(credentials: StripeCredentials, input: { paymentId: string; amountMinor: number; currency: string; description: string; customerEmail: string | null; returnUrl: string; expiresAt: number }): Promise<ProviderResult<{ id: string; url: string }>> {
  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(input.amountMinor),
    "line_items[0][price_data][product_data][name]": input.description.slice(0, 250),
    client_reference_id: input.paymentId,
    "metadata[invoicePaymentId]": input.paymentId,
    "payment_intent_data[metadata][invoicePaymentId]": input.paymentId,
    success_url: input.returnUrl,
    cancel_url: input.returnUrl,
    expires_at: String(input.expiresAt),
  });
  if (input.customerEmail) form.set("customer_email", input.customerEmail);
  const result = await call(credentials, "/v1/checkout/sessions", { form, idempotencyKey: `sww-checkout-${input.paymentId}` });
  if (!result.ok) return result;
  const { id, url } = result.data;
  return typeof id === "string" && typeof url === "string" && url.startsWith("https://") ? { ok: true, data: { id, url } } : { ok: false, error: "Stripe did not return a payment link." };
}

export async function refundStripe(credentials: StripeCredentials, input: { paymentIntentId: string; amountMinor: number; idempotencyKey: string }) {
  const form = new URLSearchParams({ payment_intent: input.paymentIntentId, amount: String(input.amountMinor) });
  return call(credentials, "/v1/refunds", { form, idempotencyKey: input.idempotencyKey });
}

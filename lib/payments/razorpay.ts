import "server-only";
import { providerReason, requestJson } from "@/lib/integrations/http";
import type { RazorpayCredentials } from "./credentials";
import type { ProviderResult } from "./stripe";

/** Plain-fetch Razorpay client. Payment links are INR only. */
const BASE = "https://api.razorpay.com";

async function call(credentials: RazorpayCredentials, path: string, body?: object): Promise<ProviderResult<Record<string, unknown>>> {
  const auth = Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64");
  const outcome = await requestJson<Record<string, unknown>>(`${BASE}${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Basic ${auth}` }, body, label: "Razorpay" });
  if (outcome.ok) return { ok: true, data: outcome.data && typeof outcome.data === "object" ? outcome.data : {} };
  const reason = providerReason(outcome.data);
  return { ok: false, error: reason ? `${outcome.error} ${reason}` : outcome.error };
}

export const verifyRazorpay = (credentials: RazorpayCredentials) => call(credentials, "/v1/payments?count=1");

export async function createRazorpayLink(credentials: RazorpayCredentials, input: { paymentId: string; amountMinor: number; currency: string; description: string; customerEmail: string | null; expireBy: number }): Promise<ProviderResult<{ id: string; url: string }>> {
  if (input.currency !== "INR") return { ok: false, error: "Razorpay payment links support INR only." };
  const result = await call(credentials, "/v1/payment_links", {
    amount: input.amountMinor,
    currency: "INR",
    description: input.description.slice(0, 2000),
    reference_id: input.paymentId,
    expire_by: input.expireBy,
    notify: { email: false, sms: false },
    reminder_enable: false,
    notes: { invoicePaymentId: input.paymentId },
    ...(input.customerEmail ? { customer: { email: input.customerEmail } } : {}),
  });
  if (!result.ok) return result;
  const { id, short_url: url } = result.data;
  return typeof id === "string" && typeof url === "string" && url.startsWith("https://") ? { ok: true, data: { id, url } } : { ok: false, error: "Razorpay did not return a payment link." };
}

export const refundRazorpay = (credentials: RazorpayCredentials, input: { paymentId: string; amountMinor: number }) =>
  call(credentials, `/v1/payments/${encodeURIComponent(input.paymentId)}/refund`, { amount: input.amountMinor });

import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/crypto";

/**
 * Webhook signature checks. Both verify the exact raw request body with a
 * constant-time comparison and fail closed on anything missing or malformed.
 */

export const STRIPE_TOLERANCE_SEC = 300;

/** Stripe-Signature: `t=<unix>,v1=<hex>[,v1=<hex>…]`, signed payload `${t}.${body}`. */
export function verifyStripeSignature(secret: string, rawBody: string, header: string | null, now = Date.now(), toleranceSec = STRIPE_TOLERANCE_SEC): boolean {
  if (!secret || !header) return false;
  let timestamp = "";
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1" && /^[a-f\d]{64}$/i.test(value)) candidates.push(value.toLowerCase());
  }
  if (!/^\d{1,12}$/.test(timestamp) || candidates.length === 0) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return candidates.some((candidate) => safeEqual(candidate, expected));
}

/** X-Razorpay-Signature: hex HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyRazorpaySignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header) return false;
  const supplied = header.trim().toLowerCase();
  if (!/^[a-f\d]{64}$/.test(supplied)) return false;
  return safeEqual(supplied, createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"));
}

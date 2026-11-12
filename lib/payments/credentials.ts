import "server-only";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { PaymentProvider } from "@prisma/client";

/**
 * Provider credentials live in one AES-256-GCM blob (purpose
 * "payment-credentials"). They are write-only: nothing here is ever returned
 * to a page, only the non-secret `mode` ("test" | "live") kept in `config`.
 */

export type PaymentMode = "test" | "live";
export type StripeCredentials = { secretKey: string; webhookSecret: string };
export type RazorpayCredentials = { keyId: string; keySecret: string; webhookSecret: string };
export type Credentials = StripeCredentials | RazorpayCredentials;

const secret = (min = 8) => z.string().trim().min(min).max(256);
export const stripeSchema = z.object({
  secretKey: z.string().trim().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/, "Enter a Stripe secret or restricted key (sk_… or rk_…)."),
  webhookSecret: z.string().trim().regex(/^whsec_[A-Za-z0-9+/=_-]{8,}$/, "The signing secret starts with whsec_.").or(z.literal("")),
});
export const razorpaySchema = z.object({
  keyId: z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]{6,}$/, "The key id starts with rzp_test_ or rzp_live_."),
  keySecret: secret(),
  webhookSecret: secret(6).or(z.literal("")),
});

export function keyMode(provider: PaymentProvider, credentials: Credentials): PaymentMode {
  const key = provider === "STRIPE" ? (credentials as StripeCredentials).secretKey : (credentials as RazorpayCredentials).keyId;
  return /_live_/.test(key) ? "live" : "test";
}

/** Live keys are only accepted when the public base URL is https. */
export function liveKeysAllowed(baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? ""): boolean {
  return baseUrl.startsWith("https://");
}

export function sealCredentials(credentials: Credentials): string {
  return encryptSecret("payment-credentials", JSON.stringify(credentials));
}

export function openCredentials(provider: PaymentProvider, sealed: string): Credentials | null {
  try {
    const raw: unknown = JSON.parse(decryptSecret("payment-credentials", sealed));
    const parsed = (provider === "STRIPE" ? stripeSchema : razorpaySchema).safeParse(raw);
    return parsed.success ? (parsed.data as Credentials) : null;
  } catch {
    return null;
  }
}

export const PROVIDER_LABEL: Record<PaymentProvider, string> = { STRIPE: "Stripe", RAZORPAY: "Razorpay" };
export const PROVIDER_SEGMENT: Record<PaymentProvider, string> = { STRIPE: "stripe", RAZORPAY: "razorpay" };
export function providerFromSegment(segment: string): PaymentProvider | null {
  return segment === "stripe" ? "STRIPE" : segment === "razorpay" ? "RAZORPAY" : null;
}

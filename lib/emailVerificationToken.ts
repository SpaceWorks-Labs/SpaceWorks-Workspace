import { sha256Hex } from "@/lib/crypto";

export const EMAIL_VERIFICATION_TTL_MS = 60 * 60_000;

/** Only this hash is stored; the raw token travels in the email link. */
export function hashEmailVerificationToken(token: string) {
  return sha256Hex(`email-verification:${token}`);
}

export function isPlausibleVerificationToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

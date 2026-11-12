import crypto from "node:crypto";
import { decodeAes256Key, hmacHex, safeEqual } from "@/lib/crypto";

/**
 * Signed, stateless campaign link tokens: `base64url(json).hmacHex`.
 * The HMAC key is an HKDF subkey for the "campaign.link" purpose (same info
 * string and root as `encryptSecret("campaign.link", ...)`).
 * Unsubscribe and preference tokens never expire; confirm tokens expire after
 * 72h (single use is enforced by ListSubscription.confirmTokenHash). Every
 * token carries the workspaceId, which callers must re-check against the row.
 */

export type CampaignTokenPurpose = "unsub" | "open" | "click" | "prefs" | "confirm";

export type CampaignTokenPayload = {
  purpose: CampaignTokenPurpose;
  workspaceId: string;
  messageId?: string;
  subscriberId?: string;
  listId?: string;
  /** Expiry as epoch milliseconds. */
  exp?: number;
};

export const CONFIRM_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

const PURPOSES = new Set<string>(["unsub", "open", "click", "prefs", "confirm"]);

function linkKey(): Buffer {
  const root = decodeAes256Key(process.env.MFA_ENCRYPTION_KEY, "MFA_ENCRYPTION_KEY");
  return Buffer.from(crypto.hkdfSync("sha256", root, Buffer.alloc(0), "sww-campaign-link-v1", 32));
}

export function signCampaignToken(input: CampaignTokenPayload, now = Date.now()): string {
  const exp = input.purpose === "confirm" ? (input.exp ?? now + CONFIRM_TOKEN_TTL_MS) : input.purpose === "unsub" || input.purpose === "prefs" ? undefined : input.exp;
  const payload = Buffer.from(JSON.stringify({ ...input, exp })).toString("base64url");
  return `${payload}.${hmacHex(linkKey(), payload)}`;
}

/** The verified payload, or null for a malformed, tampered, wrong-purpose or expired token. */
export function verifyCampaignToken(token: string, purpose: CampaignTokenPurpose, now = Date.now()): CampaignTokenPayload | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const dot = token.indexOf(".");
  if (dot < 1 || token.indexOf(".", dot + 1) !== -1) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, hmacHex(linkKey(), payload))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Partial<CampaignTokenPayload>;
  if (typeof value.purpose !== "string" || !PURPOSES.has(value.purpose) || value.purpose !== purpose) return null;
  if (typeof value.workspaceId !== "string" || !value.workspaceId) return null;
  if (value.exp !== undefined && value.exp !== null && (typeof value.exp !== "number" || value.exp <= now)) return null;
  return value as CampaignTokenPayload;
}

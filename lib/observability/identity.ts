import "server-only";
import crypto from "crypto";
import { decodeAes256Key } from "@/lib/crypto";

/**
 * Pseudonymous ids for analytics. HMAC-SHA256 under a key derived (HKDF) from
 * MFA_ENCRYPTION_KEY with its own info string, so ids cannot be reversed or
 * linked across kinds without the server key. Server-side only.
 */
export function deriveObsKey(info: string): Buffer {
  const root = decodeAes256Key(process.env.MFA_ENCRYPTION_KEY, "MFA_ENCRYPTION_KEY");
  return Buffer.from(crypto.hkdfSync("sha256", root, Buffer.alloc(0), info, 32));
}

export function pseudonymize(kind: string, id: string): string {
  return crypto.createHmac("sha256", deriveObsKey("sww-obs-pseudonym-v1")).update(`${kind}:${id}`, "utf8").digest("hex").slice(0, 32);
}

/** Distinct id for the instance project: stable per user across workspaces. */
export const pseudonymizeUser = (userId: string) => pseudonymize("user", userId);
/** Distinct id for a workspace's own project: differs per workspace. */
export const pseudonymizeUserInWorkspace = (userId: string, workspaceId: string) => pseudonymize(`user:${workspaceId}`, userId);
export const pseudonymizeWorkspace = (workspaceId: string) => pseudonymize("workspace", workspaceId);

/** Short-lived signed token minted for a page; the PostHog tunnel derives the workspace from it. */
export type ObsToken = { w: string; u: string; exp: number };
const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");

export function signObsToken(payload: { w: string; u: string }, ttlSeconds = 12 * 60 * 60, now = Date.now()): string {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSeconds }));
  return `${body}.${b64(crypto.createHmac("sha256", deriveObsKey("sww-obs-token-v1")).update(body).digest())}`;
}

export function verifyObsToken(token: string | null | undefined, now = Date.now()): ObsToken | null {
  if (!token || token.length > 512) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", deriveObsKey("sww-obs-token-v1")).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ObsToken;
    if (typeof parsed.w !== "string" || typeof parsed.u !== "string" || typeof parsed.exp !== "number" || parsed.exp * 1000 < now) return null;
    return parsed;
  } catch {
    return null;
  }
}

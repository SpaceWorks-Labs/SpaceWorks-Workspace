import "server-only";

import { importPKCS8, SignJWT } from "jose";

export type AppleCredentials = { clientId: string; teamId: string; keyId: string; privateKey: string };

/** Apple accepts a client secret for at most six months; sign for 150 days and re-sign daily. */
export const APPLE_SECRET_LIFETIME_S = 150 * 24 * 60 * 60;
const CACHE_MS = 24 * 60 * 60_000;
const CACHE_KEY = Symbol.for("sww.appleClientSecret");
type Cached = { fingerprint: string; secret: string; at: number };
const store = globalThis as unknown as Record<symbol, Cached | undefined>;

/** .p8 keys pasted into one-line fields arrive with literal "\n" sequences. */
export function normalizeApplePrivateKey(raw: string) {
  const key = raw.trim().replace(/\\n/g, "\n");
  return key.includes("\n") ? key : key.replace(/(-----BEGIN PRIVATE KEY-----)\s*(.*?)\s*(-----END PRIVATE KEY-----)/, "$1\n$2\n$3");
}

/** The JWT Apple expects in place of a static client secret (ES256, signed with the team's key). */
export async function appleClientSecret(credentials: AppleCredentials, now = Date.now()) {
  const fingerprint = [credentials.clientId, credentials.teamId, credentials.keyId, credentials.privateKey].join("\u0000");
  const cached = store[CACHE_KEY];
  if (cached && cached.fingerprint === fingerprint && now - cached.at < CACHE_MS && now >= cached.at) return cached.secret;
  const key = await importPKCS8(normalizeApplePrivateKey(credentials.privateKey), "ES256");
  const issuedAt = Math.floor(now / 1000);
  const secret = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: credentials.keyId })
    .setIssuer(credentials.teamId)
    .setSubject(credentials.clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + APPLE_SECRET_LIFETIME_S)
    .sign(key);
  store[CACHE_KEY] = { fingerprint, secret, at: now };
  return secret;
}

export function clearAppleClientSecretCache() {
  store[CACHE_KEY] = undefined;
}

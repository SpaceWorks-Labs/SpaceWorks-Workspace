import { beforeEach, describe, expect, it } from "vitest";
import { decodeJwt, decodeProtectedHeader, exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { APPLE_SECRET_LIFETIME_S, appleClientSecret, clearAppleClientSecretCache, normalizeApplePrivateKey } from "@/lib/appleClientSecret";

async function credentials() {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  return { publicKey, creds: { clientId: "org.example.web", teamId: "TEAM123456", keyId: "KEY1234567", privateKey: await exportPKCS8(privateKey) } };
}

describe("Apple client secret", () => {
  beforeEach(() => clearAppleClientSecretCache());

  it("signs an ES256 JWT with Apple's claims, valid for under six months", async () => {
    const { creds, publicKey } = await credentials();
    const now = Date.UTC(2026, 10, 12);
    const secret = await appleClientSecret(creds, now);
    expect(decodeProtectedHeader(secret)).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    const claims = decodeJwt(secret);
    expect(claims).toMatchObject({ iss: "TEAM123456", sub: "org.example.web", aud: "https://appleid.apple.com" });
    expect((claims.exp as number) - (claims.iat as number)).toBe(APPLE_SECRET_LIFETIME_S);
    expect(APPLE_SECRET_LIFETIME_S).toBeLessThanOrEqual(180 * 24 * 60 * 60);
    await expect(jwtVerify(secret, publicKey, { audience: "https://appleid.apple.com", currentDate: new Date(now + 1000) })).resolves.toBeTruthy();
  });

  it("reuses the secret for a day, then re-signs, and re-signs when the key changes", async () => {
    const { creds } = await credentials();
    const now = Date.UTC(2026, 10, 12);
    const first = await appleClientSecret(creds, now);
    expect(await appleClientSecret(creds, now + 60 * 60_000)).toBe(first);
    expect(await appleClientSecret(creds, now + 25 * 60 * 60_000)).not.toBe(first);
    const other = await credentials();
    expect(await appleClientSecret(other.creds, now + 25 * 60 * 60_000 + 1)).not.toBe(first);
  });

  it("accepts a key pasted with escaped newlines", async () => {
    const { creds } = await credentials();
    const oneLine = creds.privateKey.trim().replace(/\n/g, "\\n");
    expect(normalizeApplePrivateKey(oneLine)).toBe(creds.privateKey.trim());
    await expect(appleClientSecret({ ...creds, privateKey: oneLine })).resolves.toMatch(/^eyJ/);
  });
});

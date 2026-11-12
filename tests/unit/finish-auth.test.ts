import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthConfig, Account } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { CredentialsConfig } from "next-auth/providers/credentials";

const mocks = vi.hoisted(() => ({
  config: null as unknown as () => Promise<NextAuthConfig>,
  auth: vi.fn(), user: vi.fn(), oidc: vi.fn(), member: vi.fn(), totp: vi.fn(), recovery: vi.fn(), limited: vi.fn(),
}));
vi.mock("next-auth", () => ({ CredentialsSignin: class extends Error {}, default: (config: typeof mocks.config) => { mocks.config = config; return { auth: mocks.auth }; } }));
vi.mock("@/lib/authAdapter", () => ({ authAdapter: {} }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock("@/lib/authSettings", () => ({ getAuthSettings: async () => ({ google: null, github: null, apple: null, allowSelfSignup: false, allowedEmailDomains: [] }) }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/lib/shell/oidc", () => ({ enabledOidcProviders: mocks.oidc, existingOidcMember: mocks.member }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.limited }));
vi.mock("@/lib/mfa", () => ({ consumeMfaCode: mocks.totp, consumeRecoveryCode: mocks.recovery, decryptMfaSecret: () => "seed" }));
import "@/lib/auth";

const user = { id: "member", email: "member@example.org", name: "Member", emailVerified: null };
const account: Account = { provider: "oidc-maker", providerAccountId: "subject", type: "oidc" };
const profile = { sub: "subject", email: user.email!, email_verified: true };
const current = { ...user, sessionVersion: 3, disabledAt: null, mfaEnabledAt: new Date(), mfaSecretEncrypted: "ciphertext" };
const session = () => ({ user: { ...user }, userId: user.id, sessionToken: "test", expires: new Date(Date.now() + 3600000) }) as unknown as Parameters<NonNullable<NonNullable<NextAuthConfig["callbacks"]>["session"]>>[0]["session"];
async function tokenFor(config: NextAuthConfig, extra: Partial<Parameters<NonNullable<NonNullable<NextAuthConfig["callbacks"]>["jwt"]>>[0]> = {}) {
  return config.callbacks!.jwt!({ token: {}, user, account, profile, trigger: "signIn", ...extra });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue(null); mocks.oidc.mockResolvedValue([{ id: "oidc-maker", type: "oidc", name: "Maker SSO" }]);
  mocks.user.mockResolvedValue(current); mocks.member.mockResolvedValue(user); mocks.limited.mockResolvedValue(false);
  mocks.totp.mockResolvedValue(false); mocks.recovery.mockResolvedValue(false);
});
describe("instance OIDC authentication", () => {
  it("loads configured providers and checks the verified existing member before linking", async () => {
    const config = await mocks.config();
    expect(config.providers).toEqual(expect.arrayContaining([expect.objectContaining({ id: "oidc-maker" })]));
    expect(await config.callbacks!.signIn!({ user, account, profile })).toBe(true);
    expect(mocks.member).toHaveBeenCalledWith("oidc-maker", profile);
    mocks.auth.mockResolvedValue({ user: { id: "another-member" } });
    expect(await config.callbacks!.signIn!({ user, account, profile })).toBe(false);
    mocks.auth.mockResolvedValue(null);
    mocks.member.mockResolvedValue(null);
    expect(await config.callbacks!.signIn!({ user, account, profile })).toBe(false);
  });
  it("does not configure OIDC when none is enabled", async () => {
    mocks.oidc.mockResolvedValue([]);
    expect((await mocks.config()).providers).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "oidc" })]));
  });
  it("withholds the user from every session until the second factor succeeds", async () => {
    const config = await mocks.config();
    const token = await tokenFor(config) as JWT;
    expect(token).toMatchObject({ sub: user.id, mfaPending: true, sessionVersion: 3 });
    const pending = await config.callbacks!.session!({ session: session(), token, user: { ...user, emailVerified: null }, newSession: undefined, trigger: "update" });
    expect(pending.user).toBeUndefined();
    expect(pending).toHaveProperty("ssoMfa.userId", user.id);
    const completed = await tokenFor(config, { account: { ...account, provider: "sso-mfa", type: "credentials" } }) as JWT;
    expect(completed.mfaPending).toBe(false);
  });
  it("expires pending proof and invalidates reset or disabled sessions", async () => {
    const config = await mocks.config();
    const token = { sub: user.id, sessionVersion: 3, mfaPending: true, authenticatedAt: Date.now() - 301000 };
    expect(await tokenFor(config, { token, user: undefined, account: undefined })).toBeNull();
    expect(await tokenFor(config, { token: { ...token, sessionVersion: 2 }, user: undefined, account: undefined })).toBeNull();
    mocks.user.mockResolvedValue({ ...current, disabledAt: new Date() });
    expect(await tokenFor(config)).toBeNull();
  });
  it("requires signed challenge, rate limit, current version and valid TOTP or recovery proof", async () => {
    const config = await mocks.config();
    const entry = config.providers.find(p => typeof p === "object" && (p.id === "sso-mfa" || (p as CredentialsConfig & { options?: Partial<CredentialsConfig> }).options?.id === "sso-mfa")) as CredentialsConfig & { options?: Partial<CredentialsConfig> };
    // Provider factories keep overrides in options until Auth.js normalises them.
    const provider = { ...entry, ...entry.options } as CredentialsConfig;
    expect(await provider.authorize({ totp: "123456" }, new Request("https://example.org"))).toBeNull();
    mocks.auth.mockResolvedValue({ ssoMfa: { userId: user.id, sessionVersion: 3, authenticatedAt: Date.now() } });
    expect(await provider.authorize({ totp: "123456" }, new Request("https://example.org"))).toBeNull();
    mocks.recovery.mockResolvedValue(true);
    expect(await provider.authorize({ totp: "recovery-code" }, new Request("https://example.org"))).toMatchObject({ id: user.id, sessionVersion: 3 });
    mocks.limited.mockResolvedValue(true);
    expect(await provider.authorize({ totp: "123456" }, new Request("https://example.org"))).toBeNull();
    mocks.limited.mockResolvedValue(false); mocks.user.mockResolvedValue({ ...current, sessionVersion: 4 });
    expect(await provider.authorize({ totp: "123456" }, new Request("https://example.org"))).toBeNull();
  });
});

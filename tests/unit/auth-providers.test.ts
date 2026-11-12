import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import type { NextAuthConfig } from "next-auth";
import type { CredentialsConfig } from "next-auth/providers/credentials";

const mocks = vi.hoisted(() => ({
  config: null as unknown as () => Promise<NextAuthConfig>,
  auth: vi.fn(), user: vi.fn(), account: vi.fn(), accountCount: vi.fn(), updateMany: vi.fn(), settings: vi.fn(), limited: vi.fn(), audit: vi.fn(),
}));
vi.mock("next-auth", () => ({ CredentialsSignin: class extends Error {}, default: (config: typeof mocks.config) => { mocks.config = config; return { auth: mocks.auth }; } }));
vi.mock("@/lib/authAdapter", () => ({ authAdapter: {} }));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: mocks.user, updateMany: mocks.updateMany }, account: { findUnique: mocks.account, count: mocks.accountCount } },
}));
vi.mock("@/lib/authSettings", () => ({ getAuthSettings: mocks.settings }));
vi.mock("@/lib/appleClientSecret", () => ({ appleClientSecret: async () => "apple-secret" }));
vi.mock("@/lib/shell/oidc", () => ({ enabledOidcProviders: async () => [], existingOidcMember: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.limited }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/mfa", () => ({ consumeMfaCode: vi.fn(), consumeRecoveryCode: vi.fn(), decryptMfaSecret: () => "seed" }));
import "@/lib/auth";
import { fetchGitHubProfile } from "@/lib/authProviders";

const none = { google: null, github: null, apple: null, allowSelfSignup: false, allowedEmailDomains: [] as string[] };
const keys = { clientId: "id", clientSecret: "secret" };
const apple = { clientId: "svc", teamId: "T", keyId: "K", privateKey: "p" };
const github = { id: "github", providerAccountId: "42", provider: "github", type: "oauth" } as const;
const userObj = () => ({ id: "42", email: "raw@example.org", name: "Ana" });

// Provider factories keep overrides in options until Auth.js normalises them.
function merged(p: unknown) {
  const entry = (typeof p === "function" ? p() : p) as CredentialsConfig & { options?: Partial<CredentialsConfig> };
  return { ...entry, ...entry.options } as CredentialsConfig;
}
function ids(config: NextAuthConfig) {
  return config.providers.map((p) => merged(p).id);
}
async function signIn(profile: Record<string, unknown>, account = github, user = userObj()) {
  const config = await mocks.config();
  const result = await config.callbacks!.signIn!({ user, account: { ...account } as never, profile });
  return { result, user };
}
function credentials(config: NextAuthConfig) {
  return config.providers.map(merged).find((p) => p.id === "credentials") as CredentialsConfig;
}
const req = new Request("https://example.org");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue(none);
  mocks.auth.mockResolvedValue(null);
  mocks.account.mockResolvedValue(null);
  mocks.accountCount.mockResolvedValue(0);
  mocks.user.mockResolvedValue(null);
  mocks.limited.mockResolvedValue(false);
});

describe("provider registration", () => {
  it("registers GitHub, Google and Apple only when the instance has enabled them", async () => {
    expect(ids(await mocks.config())).toEqual(["sso-mfa", "credentials"]);
    mocks.settings.mockResolvedValue({ ...none, github: keys });
    expect(ids(await mocks.config())).toEqual(["sso-mfa", "github", "credentials"]);
    mocks.settings.mockResolvedValue({ ...none, google: keys, github: keys, apple });
    expect(ids(await mocks.config())).toEqual(["sso-mfa", "google", "github", "apple", "credentials"]);
  });
  it("still builds a working config when the settings can't be read", async () => {
    mocks.settings.mockRejectedValue(new Error("db down"));
    expect(ids(await mocks.config())).toEqual(["sso-mfa", "credentials"]);
  });
  it("GitHub profiles use only the primary verified email, not the public one", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/user/emails")
        ? Response.json([{ email: "alt@x.org", primary: false, verified: true }, { email: "main@x.org", primary: true, verified: true }])
        : Response.json({ id: 42, login: "ana", email: "public-unverified@x.org" })) as unknown as typeof fetch;
    expect(await fetchGitHubProfile("tok", fetchImpl)).toMatchObject({ id: 42, email: "main@x.org", email_verified: true });
    const unverified = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/user/emails") ? Response.json([{ email: "main@x.org", primary: true, verified: false }]) : Response.json({ id: 42, email: "public@x.org" })) as unknown as typeof fetch;
    expect(await fetchGitHubProfile("tok", unverified)).toMatchObject({ email: null, email_verified: false });
  });
});

describe("provider sign-in refusals", () => {
  const verified = { id: 42, email: "ana@example.org", email_verified: true };
  it("keeps the instance invite-only: an unknown email is refused", async () => {
    expect((await signIn(verified)).result).toBe("/login?error=not_invited");
  });
  it("refuses a provider that did not verify the email", async () => {
    expect((await signIn({ id: 42, email: "ana@example.org", email_verified: false })).result).toBe("/login?error=email_unverified");
    expect((await signIn({ id: 42, email: null, email_verified: false })).result).toBe("/login?error=email_unverified");
  });
  it("links a verified email to an existing verified member, and refuses an unverified or disabled one", async () => {
    mocks.user.mockResolvedValue({ id: "u1", disabledAt: null, emailVerified: new Date() });
    const ok = await signIn({ id: 42, email: "Ana@Example.org", email_verified: true });
    expect(ok.result).toBe(true);
    expect(ok.user.email).toBe("ana@example.org");
    mocks.user.mockResolvedValue({ id: "u1", disabledAt: null, emailVerified: null });
    expect((await signIn(verified)).result).toBe("/login?error=link_unverified");
    mocks.user.mockResolvedValue({ id: "u1", disabledAt: new Date(), emailVerified: new Date() });
    expect((await signIn(verified)).result).toBe("/login?error=disabled");
  });
  it("never auto-links an Apple private relay address", async () => {
    mocks.user.mockResolvedValue({ id: "u1", disabledAt: null, emailVerified: new Date() });
    const relay = { sub: "a1", email: "abc@privaterelay.appleid.com", email_verified: "true" };
    expect((await signIn(relay, { id: "apple", provider: "apple", providerAccountId: "a1", type: "oidc" } as never)).result).toBe("/login?error=email_in_use");
  });
  it("allows self sign-up only when the flag is on, and honours the domain list", async () => {
    mocks.settings.mockResolvedValue({ ...none, allowSelfSignup: true, allowedEmailDomains: ["example.org"] });
    expect((await signIn(verified)).result).toBe(true);
    expect((await signIn({ id: 42, email: "ana@other.org", email_verified: true })).result).toBe("/login?error=domain_not_allowed");
  });
  it("a linked account wins even when its email is no longer verified, unless the user is disabled", async () => {
    mocks.account.mockResolvedValue({ userId: "u1", user: { disabledAt: null } });
    expect((await signIn({ id: 42, email: null, email_verified: false })).result).toBe(true);
    mocks.account.mockResolvedValue({ userId: "u1", user: { disabledAt: new Date() } });
    expect((await signIn(verified)).result).toBe("/login?error=disabled");
  });
  it("connecting while signed in needs a recent sign-in and reports on the account page", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" }, authenticatedAt: Date.now() - 60 * 60_000 });
    expect((await signIn(verified)).result).toBe("/account?error=reauth_required");
    mocks.auth.mockResolvedValue({ user: { id: "u1" }, authenticatedAt: Date.now() });
    expect((await signIn(verified)).result).toBe(true);
    mocks.accountCount.mockResolvedValue(1);
    expect((await signIn(verified)).result).toBe("/account?error=provider_already_linked");
  });
  it("does not let a half-finished second factor attach another identity", async () => {
    mocks.auth.mockResolvedValue({ ssoMfa: { userId: "u1" } });
    mocks.user.mockResolvedValue({ id: "u1", disabledAt: null, emailVerified: new Date() });
    expect((await signIn(verified)).result).toBe("/login?error=mfa_pending");
  });
});

describe("username or email sign-in", () => {
  const hash = bcrypt.hashSync("correct horse battery", 4);
  const row = { id: "u1", name: "Ana", email: "ana@example.org", image: null, passwordHash: hash, sessionVersion: 2, mfaSecretEncrypted: null, mfaEnabledAt: null, disabledAt: null, emailVerified: new Date() };

  it("looks a username up by username and an email by email, and accepts the legacy email key", async () => {
    const provider = credentials(await mocks.config());
    mocks.user.mockResolvedValue(row);
    expect(await provider.authorize({ identifier: " Ana.Maker ", password: "correct horse battery" }, req)).toMatchObject({ id: "u1", sessionVersion: 2 });
    expect(mocks.user).toHaveBeenLastCalledWith(expect.objectContaining({ where: { username: "ana.maker" } }));
    await provider.authorize({ identifier: "Ana@Example.org", password: "correct horse battery" }, req);
    expect(mocks.user).toHaveBeenLastCalledWith(expect.objectContaining({ where: { email: "ana@example.org" } }));
    await provider.authorize({ email: "ana@example.org", password: "correct horse battery" }, req);
    expect(mocks.user).toHaveBeenLastCalledWith(expect.objectContaining({ where: { email: "ana@example.org" } }));
  });
  it("answers an unknown account, a wrong password and a disabled account with a wrong password identically", async () => {
    const provider = credentials(await mocks.config());
    mocks.user.mockResolvedValue(null);
    const unknown = await provider.authorize({ identifier: "nobody", password: "x" }, req);
    mocks.user.mockResolvedValue(row);
    const wrong = await provider.authorize({ identifier: "ana.maker", password: "wrong" }, req);
    mocks.user.mockResolvedValue({ ...row, disabledAt: new Date() });
    const disabledWrong = await provider.authorize({ identifier: "ana.maker", password: "wrong" }, req);
    expect([unknown, wrong, disabledWrong]).toEqual([null, null, null]);
  });
  it("says an account is switched off only after the password is right", async () => {
    const provider = credentials(await mocks.config());
    mocks.user.mockResolvedValue({ ...row, disabledAt: new Date() });
    await expect(provider.authorize({ identifier: "ana.maker", password: "correct horse battery" }, req)).rejects.toMatchObject({ code: "account_disabled" });
  });
  it("blocks password sign-in until the email is verified, only after the password is right", async () => {
    const provider = credentials(await mocks.config());
    mocks.user.mockResolvedValue({ ...row, emailVerified: null });
    await expect(provider.authorize({ identifier: "ana.maker", password: "correct horse battery" }, req)).rejects.toMatchObject({ code: "email_not_verified" });
    expect(await provider.authorize({ identifier: "ana.maker", password: "wrong" }, req)).toBeNull();
  });
  it("is rate limited by identifier", async () => {
    const provider = credentials(await mocks.config());
    mocks.limited.mockResolvedValue(true);
    // Checked before any lookup, so it says nothing about whether the account exists.
    await expect(provider.authorize({ identifier: "ana.maker", password: "correct horse battery" }, req)).rejects.toMatchObject({ code: "rate_limited" });
    expect(mocks.user).not.toHaveBeenCalled();
  });
});

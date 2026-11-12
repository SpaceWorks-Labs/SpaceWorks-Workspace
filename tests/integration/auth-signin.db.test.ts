import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const state = vi.hoisted(() => ({ userId: "", selfSignup: true, domains: [] as string[], buckets: [] as string[] }));
vi.mock("@/lib/auth", () => ({ auth: async () => (state.userId ? { user: { id: state.userId } } : null) }));
vi.mock("@/lib/reauth", () => ({ hasRecentAuthentication: async () => true }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async (bucket: string) => { state.buckets.push(bucket); return false; } }));
vi.mock("@/lib/authSettings", () => ({
  getAuthSettings: async () => ({ google: null, github: null, apple: null, allowSelfSignup: state.selfSignup, allowedEmailDomains: state.domains }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { prisma } from "@/lib/db";
import { acceptInvitation } from "@/lib/invitations";
import { createInvitationToken, invitationExpiry } from "@/lib/invitationTokens";
import { randomToken } from "@/lib/crypto";
import { hashPasswordResetToken } from "@/lib/passwordResetToken";
import { requestPasswordReset, resendEmailVerification, resetPassword, signUpWithPassword, verifyEmail } from "@/app/actions/auth";
import { setUsername } from "@/app/actions/account";
import { unlinkProvider } from "@/app/actions/connectedAccounts";
import { cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@auth-${suffix}.test`;
const slug = `auth-${suffix}`;
const PASSWORD = "a long enough password";

async function verificationToken(email: string) {
  const row = await prisma.outboxMessage.findFirstOrThrow({ where: { kind: "email-verification", payload: { path: ["to"], equals: email } }, orderBy: { createdAt: "desc" } });
  return String((row.payload as { verificationUrl: string }).verificationUrl).split("/").pop()!;
}

describe.sequential("sign-in accounts", () => {
  let ownerId: string;
  let workspaceId: string;

  beforeAll(async () => {
    ownerId = (await createUser(`owner${domain}`, "Owner")).id;
    workspaceId = (await createWorkspace(slug, ownerId)).id;
  });
  beforeEach(() => { state.userId = ""; state.selfSignup = true; state.domains = []; });
  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("keeps usernames unique, lowercase and not reserved", async () => {
    const a = await createUser(`a${domain}`);
    const b = await createUser(`b${domain}`);
    state.userId = a.id;
    expect(await setUsername({ username: "  Maker.One " })).toMatchObject({ ok: true, data: { username: "maker.one" } });
    state.userId = b.id;
    expect(await setUsername({ username: "MAKER.ONE" })).toMatchObject({ ok: false, fieldErrors: { username: ["That username is taken. Choose another."] } });
    expect(await setUsername({ username: "admin" })).toMatchObject({ ok: false });
    expect(await setUsername({ username: "maker.two" })).toMatchObject({ ok: true });
    state.userId = a.id;
    expect(await setUsername({ username: "maker.one" })).toMatchObject({ ok: true });
    expect(await setUsername({ username: "" })).toMatchObject({ ok: true, data: { username: null } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).username).toBeNull();
    // A race the pre-check can't see still fails cleanly (database unique index).
    await expect(prisma.user.update({ where: { id: a.id }, data: { username: "maker.two" } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("sends the reset link to the account email when asked by username, with the same answer for unknown names", async () => {
    const user = await createUser(`reset${domain}`);
    await prisma.user.update({ where: { id: user.id }, data: { username: `reset-${suffix}` } });
    expect(await requestPasswordReset({ identifier: `Reset-${suffix}` })).toEqual({ ok: true });
    expect(await prisma.outboxMessage.count({ where: { kind: "password-reset", payload: { path: ["to"], equals: user.email } } })).toBe(1);
    expect(await requestPasswordReset({ email: `reset${domain}` })).toEqual({ ok: true });
    expect(await requestPasswordReset({ identifier: "nobody-here" })).toEqual({ ok: true });
  });

  it("self sign-up creates an unverified account that the emailed link then verifies once", async () => {
    const email = `new${domain}`;
    expect(await signUpWithPassword({ name: "Nia", email, username: `Nia-${suffix}`, password: PASSWORD })).toEqual({ ok: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { memberships: true } });
    expect(user).toMatchObject({ emailVerified: null, username: `nia-${suffix}` });
    expect(user.memberships).toHaveLength(0);
    expect(await bcrypt.compare(PASSWORD, user.passwordHash!)).toBe(true);

    const token = await verificationToken(email);
    const stored = await prisma.emailVerificationToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toContain(token);

    // Resending replaces the pending token; the old link stops working.
    await resendEmailVerification({ identifier: `nia-${suffix}` });
    expect(await prisma.emailVerificationToken.count({ where: { userId: user.id, usedAt: null } })).toBe(1);
    expect(await verifyEmail({ token, password: PASSWORD })).toMatchObject({ ok: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).toBeNull();

    const fresh = await verificationToken(email);
    expect(await verifyEmail({ token: fresh, password: PASSWORD })).toMatchObject({ ok: true, data: { email: expect.any(String) } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).not.toBeNull();
    expect(await verifyEmail({ token: fresh, password: PASSWORD })).toMatchObject({ ok: false });
  });

  it("the confirmation link needs the sign-up password, and a wrong one keeps the link usable", async () => {
    const email = `hijack${domain}`;
    await signUpWithPassword({ name: "Attacker", email, password: "attacker chosen password" });
    const token = await verificationToken(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(await verifyEmail({ token, password: PASSWORD })).toMatchObject({ ok: false, fieldErrors: { password: [expect.any(String)] } });
    expect(await verifyEmail({ token, password: "" })).toMatchObject({ ok: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).toBeNull();
    expect(await prisma.emailVerificationToken.count({ where: { userId: user.id, usedAt: null } })).toBe(1);
    expect(await verifyEmail({ token, password: "attacker chosen password" })).toMatchObject({ ok: true });
  });

  it("signing up again before confirming replaces the pending password and sends a new link", async () => {
    const email = `again${domain}`;
    await signUpWithPassword({ name: "First", email, password: "first password long" });
    const old = await verificationToken(email);
    await signUpWithPassword({ name: "Second", email, password: "second password long" });
    const fresh = await verificationToken(email);
    expect(fresh).not.toBe(old);
    expect(await verifyEmail({ token: fresh, password: "first password long" })).toMatchObject({ ok: false });
    expect(await verifyEmail({ token: fresh, password: "second password long" })).toMatchObject({ ok: true });
    // A confirmed account is never touched by a later sign-up.
    await signUpWithPassword({ name: "Third", email, password: "third password long" });
    expect(await bcrypt.compare("second password long", (await prisma.user.findUniqueOrThrow({ where: { email } })).passwordHash!)).toBe(true);
  });

  it("a password reset from the mailbox also confirms the email", async () => {
    const email = `resetverify${domain}`;
    await signUpWithPassword({ name: "Rae", email, password: PASSWORD });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const token = randomToken(32);
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashPasswordResetToken(token), expiresAt: new Date(Date.now() + 60_000) } });
    expect(await resetPassword({ token, password: "brand new password long" })).toEqual({ ok: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.emailVerified).not.toBeNull();
    expect(await prisma.emailVerificationToken.count({ where: { userId: user.id, usedAt: null } })).toBe(0);
  });

  it("sign-up, resend and confirm draw on separate rate buckets", async () => {
    state.buckets.length = 0;
    const email = `buckets${domain}`;
    await signUpWithPassword({ name: "Bo", email, password: PASSWORD });
    await resendEmailVerification({ identifier: email });
    await verifyEmail({ token: await verificationToken(email), password: PASSWORD });
    expect(state.buckets).toEqual(["emailSignup", "emailResend", "emailConfirm"]);
  });

  it("expired tokens fail, and sign-up reveals nothing about existing emails", async () => {
    const email = `expired${domain}`;
    await signUpWithPassword({ name: "Eli", email, password: PASSWORD });
    const token = await verificationToken(email);
    await prisma.emailVerificationToken.updateMany({ where: { user: { email } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await verifyEmail({ token, password: PASSWORD })).toMatchObject({ ok: false });

    expect(await signUpWithPassword({ name: "Dup", email, password: PASSWORD })).toEqual({ ok: true });
    expect(await signUpWithPassword({ name: "Owner again", email: `owner${domain}`, password: PASSWORD })).toEqual({ ok: true });
    expect(await prisma.user.count({ where: { email: { in: [email, `owner${domain}`] } } })).toBe(2);
    expect(await resendEmailVerification({ identifier: "ghost-user" })).toEqual({ ok: true });
  });

  it("self sign-up honours the instance flag and the allowed domains", async () => {
    state.selfSignup = false;
    expect(await signUpWithPassword({ name: "No", email: `closed${domain}`, password: PASSWORD })).toMatchObject({ ok: false });
    state.selfSignup = true;
    state.domains = ["elsewhere.test"];
    expect(await signUpWithPassword({ name: "No", email: `blocked${domain}`, password: PASSWORD })).toMatchObject({ ok: false });
    expect(await prisma.user.count({ where: { email: { in: [`closed${domain}`, `blocked${domain}`] } } })).toBe(0);
  });

  it("never removes the last way to sign in", async () => {
    const withPassword = await createUser(`pw${domain}`);
    await prisma.user.update({ where: { id: withPassword.id }, data: { passwordHash: "x" } });
    await prisma.account.create({ data: { userId: withPassword.id, type: "oauth", provider: "github", providerAccountId: `gh-${suffix}-1` } });
    state.userId = withPassword.id;
    expect(await unlinkProvider({ provider: "github" })).toEqual({ ok: true });
    expect(await prisma.account.count({ where: { userId: withPassword.id } })).toBe(0);

    const social = await createUser(`social${domain}`);
    await prisma.account.createMany({ data: [
      { userId: social.id, type: "oauth", provider: "github", providerAccountId: `gh-${suffix}-2` },
      { userId: social.id, type: "oidc", provider: "google", providerAccountId: `g-${suffix}-2` },
    ] });
    state.userId = social.id;
    expect(await unlinkProvider({ provider: "github" })).toEqual({ ok: true });
    expect(await unlinkProvider({ provider: "google" })).toMatchObject({ ok: false });
    expect(await prisma.account.count({ where: { userId: social.id } })).toBe(1);
  });

  it("takes an optional username when an invitation creates the account", async () => {
    async function invite(email: string) {
      const { token, tokenHash } = createInvitationToken();
      await prisma.invitation.create({ data: { workspaceId, email, role: "MEMBER", tokenHash, expiresAt: invitationExpiry(), invitedById: ownerId } });
      return token;
    }
    const first = await acceptInvitation(await invite(`inv1${domain}`), { kind: "new", name: "One", password: PASSWORD, username: `invited-${suffix}` });
    expect(first.ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: `inv1${domain}` } })).username).toBe(`invited-${suffix}`);

    const secondToken = await invite(`inv2${domain}`);
    const clash = await acceptInvitation(secondToken, { kind: "new", name: "Two", password: PASSWORD, username: `invited-${suffix}` });
    expect(clash).toMatchObject({ ok: false, error: expect.stringMatching(/username is taken/) });
    // The invitation was not consumed by the failed attempt.
    expect((await acceptInvitation(secondToken, { kind: "new", name: "Two", password: PASSWORD })).ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: `inv2${domain}` } })).username).toBeNull();
  });
});

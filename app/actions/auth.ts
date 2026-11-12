"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { comparePassword } from "@/lib/passwordCompare";
import { getAuthSettings } from "@/lib/authSettings";
import { randomToken } from "@/lib/crypto";
import { EMAIL_VERIFICATION_TTL_MS, hashEmailVerificationToken, isPlausibleVerificationToken } from "@/lib/emailVerificationToken";
import { emailDomain } from "@/lib/oauthLinking";
import { hashPasswordResetToken, PASSWORD_RESET_TTL_MS } from "@/lib/passwordResetToken";
import { appBaseUrl } from "@/lib/notify/render";
import { enqueueEmailVerification, enqueuePasswordReset } from "@/lib/outbox";
import { parseIdentifier } from "@/lib/username";
import { getCurrentUser, isSuperAdminEmail } from "@/lib/permissions";
import { acceptInvitation } from "@/lib/invitations";
import { isSetupOpen, performSetup } from "@/lib/setup";
import { actionError, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { emailSchema, nameSchema, newPasswordSchema, timeZoneSchema, usernameSchema, workspaceSlugSchema } from "@/lib/validation";

const setupSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  username: usernameSchema.optional(),
  workspaceName: z.string().trim().min(2, "Enter a workspace name.").max(80),
  workspaceSlug: workspaceSlugSchema,
  timezone: timeZoneSchema.optional(),
});

/** First-run only: create the instance owner and first workspace. The client then signs in. */
export async function completeSetup(input: unknown): Promise<ActionResult<{ workspaceSlug: string; superAdmin: boolean }>> {
  if (await isActionRateLimited("setup")) return actionError(RATE_LIMITED);
  if (!(await isSetupOpen())) return actionError("Setup is already complete. Sign in instead.");
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await performSetup(parsed.data);
  if (!result.ok) return actionError(result.error);
  return { ok: true, data: { workspaceSlug: result.workspaceSlug, superAdmin: isSuperAdminEmail(parsed.data.email) } };
}

/** Always answers the same way so the form never reveals which emails or usernames have accounts. */
export async function requestPasswordReset(input: unknown): Promise<ActionResult> {
  // `email` is the older field name; both carry "username or email".
  const parsed = z.object({ identifier: z.string().trim().toLowerCase().min(1).max(254) }).safeParse(
    typeof input === "object" && input !== null && "email" in input && !("identifier" in input) ? { identifier: (input as { email: unknown }).email } : input,
  );
  if (!parsed.success) return actionError("Enter your username or email.");
  if (await isActionRateLimited("passwordReset", parsed.data.identifier)) return actionError(RATE_LIMITED);
  const lookup = parseIdentifier(parsed.data.identifier);
  const user = await prisma.user.findUnique({
    where: lookup.kind === "email" ? { email: lookup.value } : { username: lookup.value },
    select: { id: true, email: true, disabledAt: true },
  });
  if (user && !user.disabledAt) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    const base = appBaseUrl();
    await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashPasswordResetToken(token), expiresAt } });
      await enqueuePasswordReset(tx, { to: user.email, resetUrl: `${base}/reset-password/${token}`, expiresAt });
      await recordAuditEvent({ client: tx, action: "auth.password_reset_requested", actorId: user.id, targetType: "User", targetId: user.id });
    });
  }
  return { ok: true };
}

const resetSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This reset link isn't valid."), password: newPasswordSchema });

/** Consume a reset token once, set the password and sign out every session. */
export async function resetPassword(input: unknown): Promise<ActionResult> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (await isActionRateLimited("passwordReset")) return actionError(RATE_LIMITED);
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const tokenHash = hashPasswordResetToken(parsed.data.token);
  const done = await prisma.$transaction(async (tx) => {
    const token = await tx.passwordResetToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true } });
    if (!token) return false;
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) return false;
    await tx.user.update({ where: { id: token.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    // The link came from the mailbox, so the address is now proven too.
    await tx.user.updateMany({ where: { id: token.userId, emailVerified: null }, data: { emailVerified: new Date() } });
    await tx.emailVerificationToken.deleteMany({ where: { userId: token.userId, usedAt: null } });
    await tx.session.deleteMany({ where: { userId: token.userId } });
    await recordAuditEvent({ client: tx, action: "auth.password_reset", actorId: token.userId, targetType: "User", targetId: token.userId });
    return true;
  });
  return done ? { ok: true } : actionError("This reset link has expired or was already used. Ask for a new one.");
}

const acceptNewSchema = z.object({ token: z.string().min(1).max(64), name: nameSchema, password: newPasswordSchema, username: usernameSchema.optional() });

/** Accept an invitation by creating a new account for the invited email. The client then signs in. */
export async function acceptInviteWithNewAccount(input: unknown): Promise<ActionResult<{ workspaceSlug: string }>> {
  const parsed = acceptNewSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (await isActionRateLimited("inviteAccept")) return actionError(RATE_LIMITED);
  const result = await acceptInvitation(parsed.data.token, { kind: "new", name: parsed.data.name, password: parsed.data.password, username: parsed.data.username });
  return result.ok ? { ok: true, data: { workspaceSlug: result.workspaceSlug } } : actionError(result.error);
}

/** Accept an invitation as the signed-in member (must be the invited email). */
export async function acceptInviteAsCurrentUser(input: unknown): Promise<ActionResult<{ workspaceSlug: string }>> {
  const parsed = z.object({ token: z.string().min(1).max(64) }).safeParse(input);
  if (!parsed.success) return actionError("This invitation link isn't valid.");
  const user = await getCurrentUser();
  if (!user) return actionError("Sign in first, then open the invitation link again.");
  if (await isActionRateLimited("inviteAccept", user.id)) return actionError(RATE_LIMITED);
  const result = await acceptInvitation(parsed.data.token, { kind: "existing", userId: user.id });
  return result.ok ? { ok: true, data: { workspaceSlug: result.workspaceSlug } } : actionError(result.error);
}

// ───────────── self sign-up and email verification ─────────────

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Replace any pending token and queue one email. Call inside the transaction that created or found the user. */
async function queueVerification(tx: Tx, user: { id: string; email: string }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
  const base = appBaseUrl();
  await tx.emailVerificationToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  await tx.emailVerificationToken.create({ data: { userId: user.id, tokenHash: hashEmailVerificationToken(token), expiresAt } });
  await enqueueEmailVerification(tx, { to: user.email, verificationUrl: `${base}/verify-email/${token}`, expiresAt });
  await recordAuditEvent({ client: tx, action: "auth.verification_sent", actorId: user.id, targetType: "User", targetId: user.id });
}

const signUpSchema = z.object({ name: nameSchema, email: emailSchema, username: usernameSchema.optional(), password: newPasswordSchema });

/**
 * Self sign-up, only while the instance flag is on. The account has no
 * workspace and cannot sign in with its password until the email is confirmed.
 * An email that already has an account gets the same answer as a new one.
 * The confirmation link also needs the password chosen here, so a stranger who
 * signs up with someone else's address cannot be confirmed by that person.
 * Signing up again before confirming replaces the pending password.
 */
export async function signUpWithPassword(input: unknown): Promise<ActionResult> {
  const settings = await getAuthSettings();
  if (!settings.allowSelfSignup) return actionError("Sign-up is closed. Ask a workspace admin for an invitation.");
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (await isActionRateLimited("emailSignup", parsed.data.email)) return actionError(RATE_LIMITED);
  const domains = settings.allowedEmailDomains;
  if (domains.length > 0 && !domains.includes(emailDomain(parsed.data.email))) {
    return actionError("Sign-up isn't open to that email domain.", { email: ["Sign-up isn't open to that email domain."] });
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, email: true, emailVerified: true, disabledAt: true } });
      if (existing) {
        // A sign-up that is still waiting for its link: the latest password is the one the link accepts.
        const pending = !existing.emailVerified && !existing.disabledAt && (await tx.emailVerificationToken.count({ where: { userId: existing.id } })) > 0;
        if (pending) {
          await tx.user.update({ where: { id: existing.id }, data: { passwordHash } });
          await queueVerification(tx, existing);
        }
        return;
      }
      const user = await tx.user.create({
        data: { name: parsed.data.name, email: parsed.data.email, username: parsed.data.username ?? null, passwordHash },
        select: { id: true, email: true },
      });
      await queueVerification(tx, user);
      await recordAuditEvent({ client: tx, action: "auth.signup_requested", actorId: user.id, targetType: "User", targetId: user.id });
    });
  } catch (error) {
    if (isUniqueViolation(error, "username")) return actionError("That username is taken.", { username: ["That username is taken."] });
    if (!isUniqueViolation(error, "email")) throw error;
  }
  return { ok: true };
}

/** Always answers the same way, so it can't be used to find out which accounts exist. */
export async function resendEmailVerification(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ identifier: z.string().trim().toLowerCase().min(1).max(254) }).safeParse(input);
  if (!parsed.success) return actionError("Enter your username or email.");
  if (await isActionRateLimited("emailResend", parsed.data.identifier)) return actionError(RATE_LIMITED);
  const lookup = parseIdentifier(parsed.data.identifier);
  const user = await prisma.user.findUnique({
    where: lookup.kind === "email" ? { email: lookup.value } : { username: lookup.value },
    select: { id: true, email: true, emailVerified: true, disabledAt: true },
  });
  if (user && !user.emailVerified && !user.disabledAt) await prisma.$transaction((tx) => queueVerification(tx, user));
  return { ok: true };
}

/**
 * Consume a verification token once. Reached only by the button on /verify-email,
 * never by merely opening the link. The visitor must also enter the password
 * chosen at sign-up; a wrong one leaves the token usable.
 */
export async function verifyEmail(input: unknown): Promise<ActionResult<{ email: string }>> {
  const parsed = z.object({ token: z.string(), password: z.string().min(1, "Enter the password you chose when you signed up.").max(128) }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (!isPlausibleVerificationToken(parsed.data.token)) return actionError("This confirmation link isn't valid. Ask for a new one.");
  const tokenHash = hashEmailVerificationToken(parsed.data.token);
  if (await isActionRateLimited("emailConfirm", tokenHash)) return actionError(RATE_LIMITED);
  const pending = await prisma.emailVerificationToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    select: { user: { select: { passwordHash: true, email: true } } },
  });
  const passwordOk = await comparePassword(parsed.data.password, pending?.user.passwordHash);
  if (pending && !passwordOk) return actionError("That isn't the password you chose when you signed up.", { password: ["That isn't the password you chose when you signed up."] });
  const done = await prisma.$transaction(async (tx) => {
    const token = await tx.emailVerificationToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true } });
    if (!token) return false;
    const claimed = await tx.emailVerificationToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) return false;
    await tx.user.updateMany({ where: { id: token.userId, emailVerified: null }, data: { emailVerified: new Date() } });
    await recordAuditEvent({ client: tx, action: "auth.email_verified", actorId: token.userId, targetType: "User", targetId: token.userId });
    return true;
  });
  // The password matched, so the page may sign the person straight in with it.
  return done && pending ? { ok: true, data: { email: pending.user.email } } : actionError("This confirmation link has expired or was already used. Ask for a new one.");
}

function isUniqueViolation(error: unknown, field: string) {
  const e = error as { code?: string; meta?: { target?: unknown } } | null;
  return e?.code === "P2002" && String(e.meta?.target ?? "").includes(field);
}

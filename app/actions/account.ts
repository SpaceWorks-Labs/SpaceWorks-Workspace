"use server";

import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import {
  consumeMfaCode,
  consumeRecoveryCode,
  createMfaEnrollment,
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  storeRecoveryCodes,
  verifyMfaCode,
} from "@/lib/mfa";
import { getCurrentUser } from "@/lib/permissions";
import { actionError, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { nameSchema, newPasswordSchema, timeZoneSchema, usernameSchema } from "@/lib/validation";

const SIGN_IN_AGAIN = "Sign in again to continue.";

const profileSchema = z.object({
  name: nameSchema,
  pronouns: z.string().trim().max(40).optional().transform((v) => v || null),
  bio: z.string().trim().max(1000).optional().transform((v) => v || null),
  skills: z.array(z.string().trim().min(1).max(40)).max(30).transform((list) => [...new Set(list)]),
  timezone: z.union([timeZoneSchema, z.literal("")]).optional().transform((v) => v || null),
});

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return actionError(SIGN_IN_AGAIN);
  if (await isActionRateLimited("action", user.id)) return actionError(RATE_LIMITED);
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  await prisma.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true };
}

const TAKEN = "That username is taken. Choose another.";

/** Set, change or (with an empty value) clear the sign-in username. */
export async function setUsername(input: unknown): Promise<ActionResult<{ username: string | null }>> {
  const user = await getCurrentUser();
  if (!user) return actionError(SIGN_IN_AGAIN);
  if (await isActionRateLimited("action", user.id)) return actionError(RATE_LIMITED);
  const raw = z.object({ username: z.string().max(64) }).safeParse(input);
  if (!raw.success) return actionError("Enter a username.");
  const checked = raw.data.username.trim() === "" ? null : usernameSchema.safeParse(raw.data.username);
  if (checked && !checked.success) return validationError(checked.error);
  const username = checked?.data ?? null;
  try {
    const claimed = await prisma.$transaction(async (tx) => {
      if (username && (await tx.user.findFirst({ where: { username, NOT: { id: user.id } }, select: { id: true } }))) return false;
      await tx.user.update({ where: { id: user.id }, data: { username } });
      await recordAuditEvent({ client: tx, action: "account.username_changed", actorId: user.id, targetType: "User", targetId: user.id, metadata: { cleared: username === null } });
      return true;
    });
    if (!claimed) return actionError(TAKEN, { username: [TAKEN] });
  } catch (error) {
    // A concurrent claim can win between the check and the write.
    if ((error as { code?: string } | null)?.code === "P2002") return actionError(TAKEN, { username: [TAKEN] });
    throw error;
  }
  revalidatePath("/account");
  return { ok: true, data: { username } };
}

const passwordSchema = z.object({ currentPassword: z.string().max(128), newPassword: newPasswordSchema });

/** Change (or set, for Google-only accounts) the password. Other sessions are signed out. */
export async function changePassword(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return actionError(SIGN_IN_AGAIN);
  if (await isActionRateLimited("auth", user.id)) return actionError(RATE_LIMITED);
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (current?.passwordHash && !(await bcrypt.compare(parsed.data.currentPassword, current.passwordHash))) {
    return actionError("Your current password is wrong.", { currentPassword: ["Your current password is wrong."] });
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    await recordAuditEvent({ client: tx, action: "account.password_changed", actorId: user.id, targetType: "User", targetId: user.id });
  });
  return { ok: true };
}

/** Step 1: confirm the password, then return a new TOTP seed (held encrypted for 10 minutes). */
export async function beginMfaEnrollment(input: unknown): Promise<ActionResult<{ secret: string; uri: string; qrSvg: string }>> {
  const user = await getCurrentUser();
  if (!user) return actionError(SIGN_IN_AGAIN);
  if (await isActionRateLimited("auth", user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ password: z.string().max(128) }).safeParse(input);
  if (!parsed.success) return actionError("Enter your password.");
  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, mfaEnabledAt: true } });
  if (!current) return actionError(SIGN_IN_AGAIN);
  if (current.mfaEnabledAt) return actionError("Two-step verification is already on.");
  if (current.passwordHash && !(await bcrypt.compare(parsed.data.password, current.passwordHash))) return actionError("That password is wrong.");
  const enrollment = createMfaEnrollment(user.email);
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier: `mfa-setup:${user.id}` } }),
    prisma.verificationToken.create({ data: { identifier: `mfa-setup:${user.id}`, token: encryptMfaSecret(enrollment.secret), expires: new Date(Date.now() + 10 * 60_000) } }),
  ]);
  const qrSvg = await QRCode.toString(enrollment.uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { ok: true, data: { ...enrollment, qrSvg } };
}

/** Step 2: verify a code from the app, store the seed and return one-time recovery codes. */
export async function confirmMfaEnrollment(input: unknown): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const user = await getCurrentUser();
  if (!user) return actionError(SIGN_IN_AGAIN);
  if (await isActionRateLimited("auth", user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ code: z.string().trim().min(6).max(12) }).safeParse(input);
  if (!parsed.success) return actionError("Enter the six-digit code from your app.");
  const pending = await prisma.verificationToken.findFirst({ where: { identifier: `mfa-setup:${user.id}`, expires: { gt: new Date() } } });
  if (!pending) return actionError("Setup timed out. Start again.");
  let secret: string;
  try {
    secret = decryptMfaSecret(pending.token);
  } catch {
    return actionError("Setup timed out. Start again.");
  }
  if (!verifyMfaCode(secret, user.email, parsed.data.code)) return actionError("That code didn't match. Check the time on your phone and try again.");
  const recoveryCodes = generateRecoveryCodes();
  const enabled = await prisma.$transaction(async (tx) => {
    const consumed = await tx.verificationToken.deleteMany({ where: { identifier: `mfa-setup:${user.id}`, token: pending.token } });
    if (consumed.count !== 1) return false;
    const updated = await tx.user.updateMany({ where: { id: user.id, mfaEnabledAt: null }, data: { mfaSecretEncrypted: encryptMfaSecret(secret), mfaEnabledAt: new Date() } });
    if (updated.count !== 1) return false;
    await storeRecoveryCodes(tx, user.id, recoveryCodes);
    await recordAuditEvent({ client: tx, action: "account.mfa_enabled", actorId: user.id, targetType: "User", targetId: user.id });
    return true;
  });
  if (!enabled) return actionError("Setup changed while you were working. Start again.");
  revalidatePath("/account");
  return { ok: true, data: { recoveryCodes } };
}

/** Turn MFA off with a current authenticator code or an unused recovery code. */
export async function disableMfa(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return actionError(SIGN_IN_AGAIN);
  if (await isActionRateLimited("auth", user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ code: z.string().trim().min(6).max(32) }).safeParse(input);
  if (!parsed.success) return actionError("Enter an authenticator or recovery code.");
  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { mfaSecretEncrypted: true } });
  if (!current?.mfaSecretEncrypted) return actionError("Two-step verification is already off.");
  const valid = (await consumeMfaCode(decryptMfaSecret(current.mfaSecretEncrypted), user.email, parsed.data.code)) || (await consumeRecoveryCode(user.id, parsed.data.code));
  if (!valid) return actionError("That code didn't work.");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { mfaSecretEncrypted: null, mfaEnabledAt: null, sessionVersion: { increment: 1 } } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await recordAuditEvent({ client: tx, action: "account.mfa_disabled", actorId: user.id, targetType: "User", targetId: user.id });
  });
  return { ok: true };
}

/** Invalidate every session, including this one. */
export async function signOutEverywhere(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return actionError(SIGN_IN_AGAIN);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await recordAuditEvent({ client: tx, action: "account.sessions_revoked", actorId: user.id, targetType: "User", targetId: user.id });
  });
  return { ok: true };
}

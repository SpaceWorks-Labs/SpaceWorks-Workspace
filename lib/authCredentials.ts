import "server-only";

import { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { prisma } from "@/lib/db";
import { consumeMfaCode, consumeRecoveryCode, decryptMfaSecret } from "@/lib/mfa";
import { comparePassword } from "@/lib/passwordCompare";
import { parseIdentifier } from "@/lib/username";

const credentialsSchema = z.object({
  // Older clients post `email`; both carry "username or email".
  identifier: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(128),
  totp: z.string().trim().max(32).optional(),
});

/**
 * Returned only after the password is valid, so the sign-in screen can show
 * the second factor as its own step without revealing which emails use MFA.
 */
export class MfaRequiredError extends CredentialsSignin {
  code = "mfa_required";
}

/** Also only after a valid password, so it reveals nothing to someone who doesn't know it. */
export class EmailNotVerifiedError extends CredentialsSignin {
  code = "email_not_verified";
}

/** Only after a valid password: the instance admin switched this account off. */
export class AccountDisabledError extends CredentialsSignin {
  code = "account_disabled";
}

/** Too many attempts for this username or email. Checked before the password, so it reveals nothing. */
export class SignInRateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}

export function credentialsProvider() {
  return Credentials({
    id: "credentials",
    name: "Username or email and password",
    credentials: {
      identifier: { label: "Username or email", type: "text" },
      password: { label: "Password", type: "password" },
    },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse({ ...raw, identifier: raw.identifier ?? (raw as { email?: unknown }).email });
      if (!parsed.success) return null;
      const { identifier, password } = parsed.data;
      if (await isActionRateLimited("auth", identifier)) throw new SignInRateLimitedError();

      const lookup = parseIdentifier(identifier);
      const user = await prisma.user.findUnique({
        where: lookup.kind === "email" ? { email: lookup.value } : { username: lookup.value },
        select: { id: true, name: true, email: true, image: true, passwordHash: true, sessionVersion: true, mfaSecretEncrypted: true, mfaEnabledAt: true, disabledAt: true, emailVerified: true },
      });
      const ok = await comparePassword(password, user?.passwordHash);
      if (!user?.passwordHash || !ok) return null;
      if (user.disabledAt) throw new AccountDisabledError();
      if (!user.emailVerified) throw new EmailNotVerifiedError();

      if (user.mfaEnabledAt && user.mfaSecretEncrypted) {
        const code = parsed.data.totp ?? "";
        if (!code) throw new MfaRequiredError();
        const validTotp = await consumeMfaCode(decryptMfaSecret(user.mfaSecretEncrypted), user.email, code);
        if (!validTotp && !(await consumeRecoveryCode(user.id, code))) return null;
      }

      return { id: user.id, name: user.name, email: user.email, image: user.image, sessionVersion: user.sessionVersion };
    },
  });
}

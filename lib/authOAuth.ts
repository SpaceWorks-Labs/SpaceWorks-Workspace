import "server-only";

import type { Account, Profile, Session, User } from "next-auth";
import { getAuthSettings } from "@/lib/authSettings";
import { prisma } from "@/lib/db";
import { decideOAuthSignIn, isOAuthProvider, verifiedProfileEmail } from "@/lib/oauthLinking";

const REAUTH_WINDOW_MS = 10 * 60_000;

export type SessionWithProof = Session & { ssoMfa?: { userId: string }; authenticatedAt?: number };

/**
 * Auth.js signIn callback for Google, GitHub and Apple. Returns true to
 * continue, or the path to send the person to. Auth.js links an account to a
 * signed-in user itself, and to a matching email user only because we allow it
 * here; the policy lives in lib/oauthLinking.ts.
 */
export async function oauthSignIn(
  { user, account, profile }: { user: User; account: Account; profile?: Profile },
  getSession: () => Promise<SessionWithProof | null>,
): Promise<true | string> {
  if (!isOAuthProvider(account.provider)) return true;
  const provider = account.provider;
  const verifiedEmail = verifiedProfileEmail(profile);
  const [settings, session, linked] = await Promise.all([
    getAuthSettings(),
    getSession(),
    prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: account.providerAccountId } },
      select: { userId: true, user: { select: { disabledAt: true } } },
    }),
  ]);
  const sessionUserId = session?.user?.id ?? null;
  const authenticatedAt = session?.authenticatedAt;
  const [emailUser, held] = await Promise.all([
    verifiedEmail && !linked && !sessionUserId
      ? prisma.user.findUnique({ where: { email: verifiedEmail }, select: { id: true, disabledAt: true, emailVerified: true } })
      : null,
    sessionUserId && !linked ? prisma.account.count({ where: { userId: sessionUserId, provider } }) : 0,
  ]);
  const decision = decideOAuthSignIn({
    provider,
    verifiedEmail,
    linkedUser: linked ? { id: linked.userId, disabled: Boolean(linked.user.disabledAt) } : null,
    sessionUserId,
    pendingMfaUserId: session?.ssoMfa?.userId ?? null,
    recentAuth: typeof authenticatedAt === "number" && Date.now() - authenticatedAt >= 0 && Date.now() - authenticatedAt <= REAUTH_WINDOW_MS,
    providerHeld: held > 0,
    emailUser: emailUser ? { id: emailUser.id, disabled: Boolean(emailUser.disabledAt), emailVerified: emailUser.emailVerified !== null } : null,
    selfSignup: { enabled: settings.allowSelfSignup, allowedDomains: settings.allowedEmailDomains },
  });
  if (!decision.allow) return `${sessionUserId ? "/account" : "/login"}?error=${decision.error}`;
  // Auth.js looks the person up by this address, so it must be the normalised, verified one.
  if (decision.mode !== "link" && verifiedEmail) user.email = verifiedEmail;
  return true;
}

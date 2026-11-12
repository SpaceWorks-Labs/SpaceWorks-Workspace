import "server-only";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authAdapter } from "@/lib/authAdapter";
import { credentialsProvider } from "@/lib/authCredentials";
import { oauthSignIn, type SessionWithProof } from "@/lib/authOAuth";
import { buildOAuthProviders } from "@/lib/authProviders";
import { getAuthSettings } from "@/lib/authSettings";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { consumeMfaCode, consumeRecoveryCode, decryptMfaSecret } from "@/lib/mfa";
import { isOAuthProvider, verifiedProfileEmail } from "@/lib/oauthLinking";
import { enabledOidcProviders, existingOidcMember } from "@/lib/shell/oidc";

export const SESSION_COOKIE = "sww.session-token.v2";

type TokenExtras = { authenticatedAt?: number; sessionVersion?: number; mfaPending?: boolean };
export type SsoMfaChallenge = { userId: string; sessionVersion: number; authenticatedAt: number };

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const [settings, oidc] = await Promise.all([getAuthSettings().catch(() => null), enabledOidcProviders().catch(() => [])]);
  const oauth = settings ? await buildOAuthProviders(settings).catch(() => []) : [];
  return {
    adapter: authAdapter,
    session: { strategy: "jwt" },
    // Versioned name: changing the payload or secret retires old cookies cleanly.
    cookies: { sessionToken: { name: SESSION_COOKIE } },
    trustHost: true,
    logger: {
      // Auth.js error causes can contain provider responses and credentials.
      error() { console.error("[auth] Authentication failed"); },
    },
    pages: { signIn: "/login", error: "/login" },
    providers: [
      ...oidc,
      Credentials({
        id: "sso-mfa",
        name: "SSO verification",
        credentials: { totp: { label: "Verification code", type: "text" } },
        async authorize(raw) {
          const session = await auth();
          const proof = (session as typeof session & { ssoMfa?: SsoMfaChallenge })?.ssoMfa;
          if (!proof || Date.now() - proof.authenticatedAt > 5 * 60_000) return null;
          if (await isActionRateLimited("auth", proof.userId)) return null;
          const user = await prisma.user.findUnique({ where: { id: proof.userId } });
          if (!user || user.disabledAt || user.sessionVersion !== proof.sessionVersion || !user.mfaEnabledAt || !user.mfaSecretEncrypted) return null;
          const code = z.string().trim().min(1).max(32).safeParse(raw.totp);
          if (!code.success) return null;
          const valid = await consumeMfaCode(decryptMfaSecret(user.mfaSecretEncrypted), user.email, code.data);
          if (!valid && !(await consumeRecoveryCode(user.id, code.data))) return null;
          return { id: user.id, name: user.name, email: user.email, image: user.image, sessionVersion: user.sessionVersion };
        },
      }),
      ...oauth,
      credentialsProvider(),
    ],
    callbacks: {
      async signIn({ user, account, profile }) {
        if (account?.provider.startsWith("oidc-")) {
          const existing = await existingOidcMember(account.provider, profile);
          if (!existing) return false;
          const session = await auth();
          const currentId = session?.user?.id ?? (session as typeof session & { ssoMfa?: SsoMfaChallenge })?.ssoMfa?.userId;
          if (currentId && currentId !== existing.id) return false;
          user.email = existing.email;
          return true;
        }
        if (account && isOAuthProvider(account.provider)) {
          return oauthSignIn({ user, account, profile }, () => auth() as Promise<SessionWithProof | null>);
        }
        return true;
      },
      async jwt({ token, user, account }) {
        const userId = user?.id ?? token.sub;
        if (!userId) return null;
        const current = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true, disabledAt: true, mfaEnabledAt: true } });
        if (!current || current.disabledAt) return null;
        const extras = token as typeof token & TokenExtras;
        if (user) {
          // Bind the session to the version checked with the password, so a
          // reset racing sign-in cannot mint a session from old proof.
          const verifiedVersion = (user as typeof user & { sessionVersion?: number }).sessionVersion;
          if (verifiedVersion !== undefined && verifiedVersion !== current.sessionVersion) return null;
          token.sub = user.id;
          extras.mfaPending = Boolean(current.mfaEnabledAt && account?.type !== "credentials");
          extras.authenticatedAt = Date.now();
          if (account && account.type !== "credentials") {
            // Connecting a provider while signed in must not restart MFA or extend the re-auth window.
            const prior = (await auth()) as SessionWithProof | null;
            if (prior && prior.user?.id === user.id && prior.authenticatedAt) {
              extras.mfaPending = false;
              extras.authenticatedAt = prior.authenticatedAt;
            }
          }
          extras.sessionVersion = current.sessionVersion;
        } else if (extras.sessionVersion !== current.sessionVersion) {
          return null;
        }
        if (extras.mfaPending && Date.now() - (extras.authenticatedAt ?? 0) > 5 * 60_000) return null;
        return token;
      },
      session({ session, token }) {
        const extras = token as typeof token & TokenExtras;
        if (extras.mfaPending) {
          (session as typeof session & { ssoMfa?: SsoMfaChallenge }).ssoMfa = { userId: token.sub!, sessionVersion: extras.sessionVersion!, authenticatedAt: extras.authenticatedAt! };
          // A pending factor has no authenticated user for any page or API.
          session.user = undefined as unknown as typeof session.user;
          return session;
        }
        if (session.user && token.sub) session.user.id = token.sub;
        (session as typeof session & { authenticatedAt?: number }).authenticatedAt = (token as typeof token & TokenExtras).authenticatedAt;
        return session;
      },
    },
    events: {
      async signIn({ user, account, profile }) {
        if (!user.id || !account || !isOAuthProvider(account.provider)) return;
        // Only the address the provider verified, and only when it is this account's own email.
        const email = verifiedProfileEmail(profile);
        if (email) await prisma.user.updateMany({ where: { id: user.id, email, emailVerified: null }, data: { emailVerified: new Date() } });
      },
      async createUser({ user }) {
        if (user.id) await recordAuditEvent({ action: "auth.self_signup", actorId: user.id, targetType: "User", targetId: user.id });
      },
      async linkAccount({ user, account }) {
        if (user.id) await recordAuditEvent({ action: "auth.provider_linked", actorId: user.id, targetType: "User", targetId: user.id, metadata: { provider: account.provider } });
      },
    },
  };
});

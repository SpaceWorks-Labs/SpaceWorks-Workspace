import "server-only";

import type { Provider } from "next-auth/providers";
import Apple from "next-auth/providers/apple";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { appleClientSecret } from "@/lib/appleClientSecret";
import type { AuthSettings } from "@/lib/authSettings";
import { pickPrimaryVerifiedEmail } from "@/lib/oauthLinking";

const GITHUB_API = "https://api.github.com";

/**
 * GitHub's default profile takes the first listed email, verified or not.
 * Only the primary address GitHub has verified may ever be used for linking.
 */
export async function fetchGitHubProfile(accessToken: string, fetchImpl: typeof fetch = fetch) {
  const init = { headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "space-works", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8_000) };
  const profile = (await fetchImpl(`${GITHUB_API}/user`, init).then((res) => res.json())) as Record<string, unknown>;
  const res = await fetchImpl(`${GITHUB_API}/user/emails`, init);
  const email = res.ok ? pickPrimaryVerifiedEmail(await res.json()) : null;
  // The public profile email is user-typed and never trusted.
  return { ...profile, email, email_verified: email !== null };
}

/**
 * Providers for the instance's configured, enabled sign-in methods. Auth.js is
 * allowed to link by email here; lib/authOAuth.ts decides whether it may.
 */
export async function buildOAuthProviders(settings: AuthSettings): Promise<Provider[]> {
  const providers: Provider[] = [];
  if (settings.google) {
    providers.push(Google({ clientId: settings.google.clientId, clientSecret: settings.google.clientSecret, allowDangerousEmailAccountLinking: true }));
  }
  if (settings.github) {
    providers.push(
      GitHub({
        clientId: settings.github.clientId,
        clientSecret: settings.github.clientSecret,
        allowDangerousEmailAccountLinking: true,
        userinfo: { url: `${GITHUB_API}/user`, request: ({ tokens }: { tokens: { access_token?: string } }) => fetchGitHubProfile(tokens.access_token ?? "") },
      }),
    );
  }
  if (settings.apple) {
    providers.push(Apple({ clientId: settings.apple.clientId, clientSecret: await appleClientSecret(settings.apple), allowDangerousEmailAccountLinking: true }));
  }
  return providers;
}

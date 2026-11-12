import { auth, type SsoMfaChallenge } from "@/lib/auth";
import { publicOidcProviders } from "@/lib/shell/oidc";
import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/chrome/AuthFrame";
import { LoginForm } from "@/components/auth/LoginForm";
import { getAuthSettings } from "@/lib/authSettings";
import { safeAuthRedirect } from "@/lib/authRedirect";
import { findPendingInvitation } from "@/lib/invitations";
import type { OAuthProvider } from "@/lib/oauthLinking";
import { getCurrentUser } from "@/lib/permissions";
import { isSetupOpen } from "@/lib/setup";

export const metadata: Metadata = { title: "Sign in" };

/** Signed in already: go where the visitor was heading. Arriving from an invitation pre-fills the invited email. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await isSetupOpen()) redirect("/setup");
  const { callbackUrl } = await searchParams;
  const next = safeAuthRedirect(typeof callbackUrl === "string" ? callbackUrl : null);
  if (await getCurrentUser()) redirect(next);
  const settings = await getAuthSettings().catch(() => null);
  const providers = (["google", "github", "apple"] as const).filter((p): p is OAuthProvider => Boolean(settings?.[p]));
  const oidcProviders = await publicOidcProviders().catch(() => []);
  const session = await auth();
  const ssoMfa = Boolean((session as typeof session & { ssoMfa?: SsoMfaChallenge })?.ssoMfa);
  const inviteToken = /^\/invite\/([A-Za-z0-9_-]{43})$/.exec(next)?.[1];
  const invitation = inviteToken ? await findPendingInvitation(inviteToken) : null;
  return (
    <AuthFrame
      title={invitation ? `Sign in to join ${invitation.workspace.name}.` : "Welcome back."}
      description={invitation ? `Use the account for ${invitation.email}. You'll go straight back to the invitation.` : "Sign in to your community workspace."}
    >
      <Suspense fallback={<p className="text-body-ui text-ink-muted">Loading sign in</p>}>
        <LoginForm providers={providers} oidcProviders={oidcProviders} ssoMfa={ssoMfa} allowSignup={Boolean(settings?.allowSelfSignup)} defaultIdentifier={invitation?.email} />
      </Suspense>
    </AuthFrame>
  );
}

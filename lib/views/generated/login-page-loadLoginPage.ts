// Generated from app/login/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { auth, type SsoMfaChallenge } from "@/lib/auth";
import { publicOidcProviders } from "@/lib/shell/oidc";
import { redirect } from "next/navigation";
import { getAuthSettings } from "@/lib/authSettings";
import { safeAuthRedirect } from "@/lib/authRedirect";
import { findPendingInvitation } from "@/lib/invitations";
import type { OAuthProvider } from "@/lib/oauthLinking";
import { getCurrentUser } from "@/lib/permissions";
import { isSetupOpen } from "@/lib/setup";

export async function loadLoginPage({ searchParams }: PageProps<"/login">) {
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
return viewDto({ settings, providers, oidcProviders, ssoMfa, invitation } as const);
}

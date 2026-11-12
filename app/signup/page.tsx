import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/chrome/AuthFrame";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { getAuthSettings } from "@/lib/authSettings";
import type { OAuthProvider } from "@/lib/oauthLinking";
import { getCurrentUser } from "@/lib/permissions";
import { isSetupOpen } from "@/lib/setup";

export const metadata: Metadata = { title: "Create an account" };

/** Only reachable while the instance's self sign-up flag is on. */
export default async function SignUpPage() {
  if (await isSetupOpen()) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const settings = await getAuthSettings().catch(() => null);
  if (!settings?.allowSelfSignup) redirect("/login");
  const providers = (["google", "github", "apple"] as const).filter((p): p is OAuthProvider => Boolean(settings[p]));
  return (
    <AuthFrame title="Create your account." description="You'll confirm your email, then join or request a workspace.">
      <SignUpForm providers={providers} domains={settings.allowedEmailDomains} />
    </AuthFrame>
  );
}

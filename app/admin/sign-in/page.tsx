import { SignInSettings } from "@/components/admin/SignInSettings";
import { PageHeader } from "@/components/ui/display";
import { getInstanceSettings, getInstanceSettingsForDisplay } from "@/lib/instanceSettings";
import { requireSuperAdminMfa } from "@/lib/permissions";

export const metadata = { title: "Sign-in" };

const PLAIN = [
  "google.enabled", "google.clientId", "github.enabled", "github.clientId",
  "apple.enabled", "apple.clientId", "apple.teamId", "apple.keyId", "auth.allowSelfSignup", "auth.allowedEmailDomains",
] as const;
const SECRETS = ["google.clientSecret", "github.clientSecret", "apple.privateKey"];

export default async function AdminSignInPage() {
  await requireSuperAdminMfa();
  const [resolved, display] = await Promise.all([getInstanceSettings(PLAIN), getInstanceSettingsForDisplay()]);
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Sign-in" description="Choose how people sign in. Passwords and email confirmation are always on; providers are optional and never create accounts unless self sign-up is on." />
      <SignInSettings
        values={Object.fromEntries(PLAIN.map((key) => [key, resolved[key] ?? ""]))}
        secretsSet={display.filter((s) => SECRETS.includes(s.key) && s.isSet).map((s) => s.key)}
        baseUrl={baseUrl}
      />
    </div>
  );
}

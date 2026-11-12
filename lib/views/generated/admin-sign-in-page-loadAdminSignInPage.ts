// Generated from app/admin/sign-in/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { getInstanceSettings, getInstanceSettingsForDisplay } from "@/lib/instanceSettings";
import { requireSuperAdminMfa } from "@/lib/permissions";
const PLAIN = [
  "google.enabled", "google.clientId", "github.enabled", "github.clientId",
  "apple.enabled", "apple.clientId", "apple.teamId", "apple.keyId", "auth.allowSelfSignup", "auth.allowedEmailDomains",
] as const;
const SECRETS = ["google.clientSecret", "github.clientSecret", "apple.privateKey"];
export async function loadAdminSignInPage() {
await requireSuperAdminMfa();
const [resolved, display] = await Promise.all([getInstanceSettings(PLAIN), getInstanceSettingsForDisplay()]);
const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
return viewDto({ resolved, display, baseUrl } as const);
}

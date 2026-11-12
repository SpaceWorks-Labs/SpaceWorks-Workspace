// Generated from app/signup/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { redirect } from "next/navigation";
import { getAuthSettings } from "@/lib/authSettings";
import type { OAuthProvider } from "@/lib/oauthLinking";
import { getCurrentUser } from "@/lib/permissions";
import { isSetupOpen } from "@/lib/setup";

export async function loadSignUpPage() {
if (await isSetupOpen()) redirect("/setup");
if (await getCurrentUser()) redirect("/");
const settings = await getAuthSettings().catch(() => null);
if (!settings?.allowSelfSignup) redirect("/login");
const providers = (["google", "github", "apple"] as const).filter((p): p is OAuthProvider => Boolean(settings[p]));
return viewDto({ settings, providers } as const);
}

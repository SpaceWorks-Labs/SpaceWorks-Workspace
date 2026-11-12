import "server-only";
import { getCurrentUser } from "@/lib/permissions";
import type { LoaderProps } from "./config";
import { getObsSettings } from "./keys";
import { instancePublicConfig, resolveWorkspacePublicConfig } from "./resolve";

/** What the backend decides for the root-layout loader; the layout adds the nonce and the consent cookie itself. */
export type LoaderConfig = Pick<LoaderProps, "config" | "consentMode" | "signedIn">;

/** Public analytics config for the current visitor, or null when nothing observable is enabled. Never throws. */
export async function getLoaderConfig(workspaceSlug: string | null): Promise<LoaderConfig | null> {
  try {
    const settings = await getObsSettings();
    const anything = settings.sentry.enabled || settings.posthog.enabled || settings.clarity.enabled || settings.firebase.enabled || settings.overrides.allowed;
    if (!anything) return null;
    const user = await getCurrentUser();
    const config = user && workspaceSlug ? await resolveWorkspacePublicConfig(workspaceSlug, user.id, settings) : instancePublicConfig(settings);
    return { config, consentMode: settings.consentMode, signedIn: Boolean(user) };
  } catch {
    return null;
  }
}

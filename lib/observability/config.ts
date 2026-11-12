import type { ConsentMode, ConsentState } from "./consent";

export const CLIENT_PROVIDERS = ["sentry", "posthog", "clarity", "firebase"] as const;
export type ClientProvider = (typeof CLIENT_PROVIDERS)[number];
export const ALL_PROVIDERS = [...CLIENT_PROVIDERS, "metrics", "grafana", "metabase"] as const;
export type ProviderId = (typeof ALL_PROVIDERS)[number];
/** Providers a workspace may configure on its own. */
export const WORKSPACE_PROVIDERS = ["posthog", "clarity", "grafana", "metabase"] as const;
export type WorkspaceProvider = (typeof WORKSPACE_PROVIDERS)[number];
export const WORKSPACE_MODES = ["inherit", "own", "off", "linkout"] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

export function isProviderId(value: string): value is ProviderId {
  return (ALL_PROVIDERS as readonly string[]).includes(value);
}
export function isWorkspaceProvider(value: string): value is WorkspaceProvider {
  return (WORKSPACE_PROVIDERS as readonly string[]).includes(value);
}

/** Public keys only. Nothing here is a secret or an identifier of a person. */
export type PublicObsConfig = {
  sentry: { dsn: string; environment: string; release: string; tracesSampleRate: number } | null;
  posthog: { key: string; tunnelToken: string | null; distinctId: string; groupId: string | null } | null;
  clarity: { projectId: string } | null;
  firebase: { measurementId: string } | null;
  /** Opaque, changes when the workspace changes so the loader can re-initialise. */
  scopeKey: string;
};

export type LoaderProps = { nonce: string; config: PublicObsConfig; consentMode: ConsentMode; consent: ConsentState; signedIn: boolean };

export const EMPTY_PUBLIC_CONFIG: PublicObsConfig = { sentry: null, posthog: null, clarity: null, firebase: null, scopeKey: "none" };

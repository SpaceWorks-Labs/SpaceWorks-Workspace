import "server-only";
import { findWorkspaceForUser } from "@/lib/permissions";
import { EMPTY_PUBLIC_CONFIG, type PublicObsConfig } from "./config";
import { getObsSettings, type ObsSettings } from "./keys";
import { pseudonymizeUser, pseudonymizeUserInWorkspace, pseudonymizeWorkspace, signObsToken } from "./identity";
import { resolveWorkspaceConnection } from "./workspaceConfig";
import { appRelease } from "./release";

export function sentryPublicConfig(s: ObsSettings): PublicObsConfig["sentry"] {
  if (!s.sentry.enabled || !s.sentry.dsn) return null;
  return { dsn: s.sentry.dsn, environment: s.sentry.environment, release: appRelease(), tracesSampleRate: 0 };
}

/** Sentry only: used where no workspace is in scope (login, account). */
export function instancePublicConfig(s: ObsSettings): PublicObsConfig {
  return { ...EMPTY_PUBLIC_CONFIG, sentry: sentryPublicConfig(s), scopeKey: "instance" };
}

/**
 * Public config for a signed-in user on a workspace page. Membership is
 * checked here; a non-member, or the super admin acting outside their own
 * membership, gets Sentry only. Firebase is instance-only (never per workspace).
 */
export async function resolveWorkspacePublicConfig(slug: string, userId: string, settings?: ObsSettings): Promise<PublicObsConfig> {
  const s = settings ?? (await getObsSettings());
  const base = instancePublicConfig(s);
  const found = await findWorkspaceForUser(slug, userId);
  if (!found || (found.membership as { viaSuperAdmin?: boolean }).viaSuperAdmin) return base;
  const workspaceId = found.workspace.id;
  const [posthog, clarity] = await Promise.all([
    resolveWorkspaceConnection("posthog", workspaceId, { settings: s }),
    resolveWorkspaceConnection("clarity", workspaceId, { settings: s }),
  ]);
  const own = posthog.source === "workspace";
  return {
    ...base,
    scopeKey: pseudonymizeWorkspace(workspaceId),
    posthog: posthog.active && posthog.config.key
      ? {
          key: posthog.config.key,
          tunnelToken: signObsToken({ w: workspaceId, u: userId }),
          distinctId: own ? pseudonymizeUserInWorkspace(userId, workspaceId) : pseudonymizeUser(userId),
          groupId: own ? null : pseudonymizeWorkspace(workspaceId),
        }
      : null,
    clarity: clarity.active && clarity.config.projectId ? { projectId: clarity.config.projectId } : null,
    firebase: s.firebase.enabled && s.firebase.measurementId ? { measurementId: s.firebase.measurementId } : null,
  };
}

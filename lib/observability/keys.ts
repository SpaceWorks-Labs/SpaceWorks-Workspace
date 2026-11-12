import "server-only";
import { getInstanceSettings } from "@/lib/instanceSettings";
import { parseConsentMode, type ConsentMode } from "./consent";
import { WORKSPACE_PROVIDERS, type WorkspaceProvider } from "./config";

export const OBS_SETTING_KEYS = [
  "obs.sentry.enabled", "obs.sentry.dsn", "obs.sentry.environment", "obs.sentry.tracesSampleRate",
  "obs.posthog.enabled", "obs.posthog.key", "obs.posthog.host",
  "obs.clarity.enabled", "obs.clarity.projectId",
  "obs.firebase.enabled", "obs.firebase.measurementId",
  "obs.metrics.enabled", "obs.grafana.url", "obs.grafana.dashboardPath",
  "obs.metabase.enabled", "obs.metabase.siteUrl", "obs.metabase.secretKey", "obs.metabase.adminDashboardIds",
  "obs.consentMode", "obs.workspaceOverrides.allowed", "obs.workspaceOverrides.providers", "obs.workspaceOverrides.hostAllowlist",
] as const;

export type ObsSettings = {
  sentry: { enabled: boolean; dsn: string | null; environment: string; tracesSampleRate: number };
  posthog: { enabled: boolean; key: string | null; host: string };
  clarity: { enabled: boolean; projectId: string | null };
  firebase: { enabled: boolean; measurementId: string | null };
  metrics: { enabled: boolean };
  grafana: { url: string | null; dashboardPath: string | null };
  metabase: { enabled: boolean; siteUrl: string | null; secretKey: string | null; adminDashboardIds: string[] };
  consentMode: ConsentMode;
  overrides: { allowed: boolean; providers: WorkspaceProvider[]; hostAllowlist: string[] };
};

export const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";
const truthy = (value: string | undefined) => value === "true" || value === "1";
export const splitList = (value: string | undefined) => (value ?? "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);

export async function getObsSettings(): Promise<ObsSettings> {
  const s = await getInstanceSettings(OBS_SETTING_KEYS);
  const rate = Number.parseFloat(s["obs.sentry.tracesSampleRate"] ?? "0");
  return {
    sentry: { enabled: truthy(s["obs.sentry.enabled"]), dsn: s["obs.sentry.dsn"] ?? null, environment: s["obs.sentry.environment"] ?? process.env.NODE_ENV ?? "production", tracesSampleRate: Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0 },
    posthog: { enabled: truthy(s["obs.posthog.enabled"]), key: s["obs.posthog.key"] ?? null, host: (s["obs.posthog.host"] ?? DEFAULT_POSTHOG_HOST).replace(/\/+$/, "") },
    clarity: { enabled: truthy(s["obs.clarity.enabled"]), projectId: s["obs.clarity.projectId"] ?? null },
    firebase: { enabled: truthy(s["obs.firebase.enabled"]), measurementId: s["obs.firebase.measurementId"] ?? null },
    metrics: { enabled: truthy(s["obs.metrics.enabled"]) },
    grafana: { url: s["obs.grafana.url"] ?? null, dashboardPath: s["obs.grafana.dashboardPath"] ?? null },
    metabase: { enabled: truthy(s["obs.metabase.enabled"]), siteUrl: s["obs.metabase.siteUrl"] ?? null, secretKey: s["obs.metabase.secretKey"] ?? null, adminDashboardIds: splitList(s["obs.metabase.adminDashboardIds"]) },
    consentMode: parseConsentMode(s["obs.consentMode"]),
    overrides: {
      allowed: truthy(s["obs.workspaceOverrides.allowed"]),
      providers: splitList(s["obs.workspaceOverrides.providers"]).filter((p): p is WorkspaceProvider => (WORKSPACE_PROVIDERS as readonly string[]).includes(p)),
      hostAllowlist: splitList(s["obs.workspaceOverrides.hostAllowlist"]).map((h) => h.toLowerCase()),
    },
  };
}

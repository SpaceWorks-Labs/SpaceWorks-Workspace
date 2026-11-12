import "server-only";

import { prisma } from "@/lib/db";
import { getProviderStatus } from "@/lib/observability";
import { PROVIDERS } from "@/lib/observability/admin/providers";
import { getObsSettings } from "@/lib/observability/keys";
import { providerDashboardUrl } from "./compute";
import type { PlatformStatus } from "./types";

/** Latest `admin.observability_tested` result per provider (metadata `{ provider, ok }`). */
async function lastTests(): Promise<Map<string, { ok: boolean; at: string }>> {
  const events = await prisma.auditEvent.findMany({
    where: { action: "admin.observability_tested" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { metadata: true, createdAt: true },
  });
  const out = new Map<string, { ok: boolean; at: string }>();
  for (const event of events) {
    const meta = event.metadata as { provider?: unknown; ok?: unknown } | null;
    if (typeof meta?.provider !== "string" || out.has(meta.provider)) continue;
    out.set(meta.provider, { ok: meta.ok === true, at: event.createdAt.toISOString() });
  }
  return out;
}

const DETAIL: Partial<Record<string, string>> = {
  sentry: "The DSN is write-only, so open Sentry from your own account.",
  firebase: "Open Google Analytics for the property that owns this measurement id.",
  metrics: "Prometheus scrapes /api/metrics with the bearer token.",
};

/**
 * Status of every analytics and monitoring integration: on or off, what is
 * missing, the last console test and a dashboard link when a non-secret
 * setting names it. Secrets (DSN, embedding key, metrics token) never leave here.
 */
export async function loadPlatforms(): Promise<PlatformStatus[]> {
  const [settings, tests, statuses] = await Promise.all([
    getObsSettings(),
    lastTests(),
    Promise.all(PROVIDERS.map((provider) => getProviderStatus(provider.id).catch(() => null))),
  ]);
  const links = {
    posthogHost: settings.posthog.host,
    clarityProjectId: settings.clarity.projectId,
    grafanaUrl: settings.grafana.url,
    grafanaPath: settings.grafana.dashboardPath,
    metabaseSiteUrl: settings.metabase.siteUrl,
  };
  return PROVIDERS.map((provider, index) => {
    const status = statuses[index];
    return {
      id: provider.id,
      title: provider.title,
      enabled: status?.enabled ?? false,
      configured: status?.configured ?? false,
      missing: status?.missing ?? ["Status unavailable"],
      lastTest: tests.get(provider.id) ?? null,
      dashboardUrl: providerDashboardUrl(provider.id, links),
      detail: DETAIL[provider.id] ?? null,
    };
  });
}

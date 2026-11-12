import "server-only";
import { prisma } from "@/lib/db";
import { INSTANCE_SETTING_KEYS, type InstanceSettingKey } from "@/lib/instanceSettings";
import { observabilityCspSources } from "./csp";
import { getObsSettings } from "./keys";
import { parseDsn, envelopeUrl } from "./sentry/dsn";
import { pseudonymize } from "./identity";
import { CLARITY_PROJECT_PATTERN, FIREBASE_MEASUREMENT_PATTERN } from "./patterns";
import type { ProviderId } from "./config";

export type ProviderStatus = {
  provider: ProviderId;
  enabled: boolean;
  configured: boolean;
  /** What is still missing for the provider to work. */
  missing: string[];
  /** Where each stored value comes from. */
  source: "database" | "environment" | "unset";
  csp: { required: string[]; allowed: boolean; hint: string | null };
  /** Plain-language privacy note for the admin card. */
  privacy: string;
};

const PRIVACY: Record<ProviderId, string> = {
  sentry: "Errors only, scrubbed of cookies, headers, bodies, query strings and ids. Not gated by consent.",
  posthog: "Pseudonymous ids only, templated paths, no autocapture or recording. Gated by consent, Do Not Track and Global Privacy Control.",
  clarity: "Session recordings with strict masking. Each workspace owner must opt in. Gated by consent, Do Not Track and Global Privacy Control.",
  firebase: "Google Analytics page views only: no ad signals, no user id, IP anonymised. Gated by consent, Do Not Track and Global Privacy Control.",
  metrics: "Aggregate server metrics only, never per workspace or person.",
  grafana: "A link only; nothing is sent.",
  metabase: "Embedded dashboards read from reporting views that exclude names, emails and message text.",
};

async function sourceOf(provider: ProviderId): Promise<ProviderStatus["source"]> {
  const keys = (Object.keys(INSTANCE_SETTING_KEYS) as InstanceSettingKey[]).filter((k) => k.startsWith(`obs.${provider}.`));
  const rows = await prisma.instanceSetting.findMany({ where: { key: { in: keys } }, select: { key: true } });
  if (rows.length > 0) return "database";
  return keys.some((k) => process.env[INSTANCE_SETTING_KEYS[k].env]?.trim()) ? "environment" : "unset";
}

/** Fixed origins a browser must be allowed to reach for the provider (from csp.ts). */
function requiredOrigins(provider: ProviderId): string[] {
  const probe = observabilityCspSources({ OBS_CSP_PROVIDERS: provider });
  return [...probe.connect, ...probe.frame];
}

export async function getProviderStatus(provider: ProviderId): Promise<ProviderStatus> {
  const s = await getObsSettings();
  let enabled = false;
  const missing: string[] = [];
  switch (provider) {
    case "sentry": enabled = s.sentry.enabled; if (!parseDsn(s.sentry.dsn)) missing.push("A valid https DSN"); break;
    case "posthog": enabled = s.posthog.enabled; if (!s.posthog.key) missing.push("Project key"); break;
    case "clarity": enabled = s.clarity.enabled; if (!s.clarity.projectId || !CLARITY_PROJECT_PATTERN.test(s.clarity.projectId)) missing.push("Project id"); break;
    case "firebase": enabled = s.firebase.enabled; if (!s.firebase.measurementId || !FIREBASE_MEASUREMENT_PATTERN.test(s.firebase.measurementId)) missing.push("Measurement id (G-XXXX)"); break;
    case "metabase": enabled = s.metabase.enabled; if (!s.metabase.siteUrl) missing.push("Site URL"); if (!s.metabase.secretKey) missing.push("Embedding secret"); break;
    case "grafana": enabled = Boolean(s.grafana.url); break;
    case "metrics": enabled = s.metrics.enabled; break;
  }
  const required = requiredOrigins(provider);
  const live = observabilityCspSources();
  const allowed = required.every((o) => live.connect.includes(o) || live.frame.includes(o));
  return {
    provider, enabled, configured: missing.length === 0, missing, source: await sourceOf(provider),
    csp: { required, allowed, hint: allowed ? null : `Add ${provider} to OBS_CSP_PROVIDERS and restart.` },
    privacy: PRIVACY[provider],
  };
}

export type TestResult = { ok: boolean; message: string };

async function post(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(8000) });
}

/** Send one harmless test event (Sentry, PostHog) or validate the configuration (Clarity, Firebase). */
export async function testProvider(provider: ProviderId, fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  const s = await getObsSettings();
  try {
    if (provider === "sentry") {
      const dsn = parseDsn(s.sentry.dsn);
      if (!dsn) return { ok: false, message: "Add a valid https DSN first." };
      const id = crypto.randomUUID().replace(/-/g, "");
      const body = [JSON.stringify({ event_id: id, dsn: s.sentry.dsn }), JSON.stringify({ type: "event" }), JSON.stringify({ event_id: id, level: "info", message: "Space Works test event", platform: "node", environment: s.sentry.environment })].join("\n");
      const res = await post(envelopeUrl(dsn), { method: "POST", headers: { "content-type": "application/x-sentry-envelope" }, body }, fetchImpl);
      return res.ok ? { ok: true, message: "Test event sent to Sentry." } : { ok: false, message: `Sentry answered ${res.status}. Check the DSN.` };
    }
    if (provider === "posthog") {
      if (!s.posthog.key) return { ok: false, message: "Add the project key first." };
      const res = await post(`${s.posthog.host}/capture/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: s.posthog.key, event: "sww_test_event", distinct_id: pseudonymize("test", "instance"), properties: { $process_person_profile: false } }) }, fetchImpl);
      return res.ok ? { ok: true, message: "Test event sent to PostHog." } : { ok: false, message: `PostHog answered ${res.status}. Check the key and host.` };
    }
    if (provider === "clarity") return s.clarity.projectId && CLARITY_PROJECT_PATTERN.test(s.clarity.projectId) ? { ok: true, message: "Project id looks valid. Open a workspace page after an owner opts in to confirm recordings arrive." } : { ok: false, message: "Enter a valid Clarity project id." };
    if (provider === "firebase") return s.firebase.measurementId && FIREBASE_MEASUREMENT_PATTERN.test(s.firebase.measurementId) ? { ok: true, message: "Measurement id looks valid. Check Realtime in Google Analytics after opening a workspace page." } : { ok: false, message: "Enter a measurement id like G-ABC123XYZ." };
  } catch {
    return { ok: false, message: "Could not reach the provider. Check the address and network." };
  }
  return { ok: false, message: "This provider has no client test." };
}

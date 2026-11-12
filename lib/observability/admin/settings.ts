import "server-only";
import { getInstanceSettings, getInstanceSettingsForDisplay, INSTANCE_SETTING_KEYS, type InstanceSettingKey } from "@/lib/instanceSettings";
import { parseProviders } from "@/lib/observability/csp";
import { frameAllowed } from "@/lib/observability/metabase/frame";
import { ADMIN_KEYS, PROVIDERS, type ProviderId } from "./providers";

const keys = [...new Set([...ADMIN_KEYS, "obs.metrics.token"])] as InstanceSettingKey[];

/** Typed instance getters for the console and the actions. Secrets stay server-side. */
export async function getObservabilityValues() {
  return getInstanceSettings(keys);
}

export type ConsoleData = {
  /** Resolved plain values (database, then environment) for non-secret keys. */
  values: Record<string, string>;
  /** Secret keys that already hold a value. */
  secretsSet: string[];
  /** Where each key's value comes from. */
  sources: Record<string, "database" | "environment" | "unset">;
  /** Per provider: is it allowed by the CSP environment variables. */
  csp: Record<ProviderId, { allowed: boolean; detail: string }>;
};

export async function getConsoleData(): Promise<ConsoleData> {
  const [resolved, display] = await Promise.all([getObservabilityValues(), getInstanceSettingsForDisplay()]);
  const values: Record<string, string> = {};
  const secretsSet: string[] = [];
  const sources: ConsoleData["sources"] = {};
  for (const key of keys) {
    if (INSTANCE_SETTING_KEYS[key].secret) continue;
    values[key] = resolved[key] ?? "";
  }
  for (const row of display) {
    if (!keys.includes(row.key)) continue;
    sources[row.key] = row.source;
    if (row.secret && row.isSet) secretsSet.push(row.key);
  }
  const listed = parseProviders(process.env.OBS_CSP_PROVIDERS);
  const csp = Object.fromEntries(PROVIDERS.map((p) => {
    if (p.id === "metabase") {
      const ok = frameAllowed(resolved["obs.metabase.siteUrl"]);
      return [p.id, { allowed: ok, detail: ok ? "The Metabase origin is in OBS_CSP_FRAME_ORIGINS, so dashboards can be framed." : "Add the Metabase origin to OBS_CSP_FRAME_ORIGINS to frame dashboards. Until then a link is shown." }];
    }
    if (p.id === "sentry" || p.id === "posthog" || p.id === "metrics" || p.id === "grafana") return [p.id, { allowed: true, detail: "No extra browser origin is needed." }];
    const ok = listed.includes(p.id);
    return [p.id, { allowed: ok, detail: ok ? `${p.title} is listed in OBS_CSP_PROVIDERS.` : `Add ${p.id} to OBS_CSP_PROVIDERS and redeploy, or the browser blocks it.` }];
  })) as ConsoleData["csp"];
  return { values, secretsSet, sources, csp };
}

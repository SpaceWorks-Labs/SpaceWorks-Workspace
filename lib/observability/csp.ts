/**
 * Content Security Policy sources for the observability providers. Reads the
 * environment only, so it stays edge-safe (no database, no server-only
 * imports). script-src is never touched: loaders rely on the nonce and
 * strict-dynamic already in lib/pageSecurity.ts.
 */
type Sources = { connect: string[]; frame: string[] };

const PROVIDER_SOURCES: Record<string, Partial<Sources>> = {
  clarity: { connect: ["https://*.clarity.ms", "https://c.bing.com"] },
  firebase: { connect: ["https://www.google-analytics.com", "https://*.google-analytics.com", "https://*.analytics.google.com", "https://www.googletagmanager.com"] },
  // The browser only talks to the same-origin tunnels for these.
  posthog: {},
  sentry: {},
  metabase: {},
  grafana: {},
};

export const CSP_PROVIDER_NAMES = Object.keys(PROVIDER_SOURCES);

const ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(?::[0-9]{1,5})?$/i;

/** Accept only plain https origins: no wildcards, paths, queries or credentials. */
export function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const item of raw.split(/[\s,]+/)) {
    const value = item.trim().toLowerCase();
    if (value && ORIGIN.test(value)) out.add(value);
  }
  return [...out];
}

export function parseProviders(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter((item) => item in PROVIDER_SOURCES))];
}

export function observabilityCspSources(env: Record<string, string | undefined> = process.env): Sources {
  const connect = new Set<string>();
  const frame = new Set<string>();
  for (const provider of parseProviders(env.OBS_CSP_PROVIDERS)) {
    for (const origin of PROVIDER_SOURCES[provider]?.connect ?? []) connect.add(origin);
    for (const origin of PROVIDER_SOURCES[provider]?.frame ?? []) frame.add(origin);
  }
  for (const origin of parseOrigins(env.OBS_CSP_CONNECT_ORIGINS)) connect.add(origin);
  for (const origin of parseOrigins(env.OBS_CSP_FRAME_ORIGINS)) frame.add(origin);
  return { connect: [...connect], frame: [...frame] };
}

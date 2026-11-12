import { ADMIN_KEYS, CONSENT_MODES, OVERRIDABLE_PROVIDERS, PROVIDERS } from "./providers";
import { parseDashboardIds } from "@/lib/observability/metabase/sign";

export type Updates = Record<string, string | null>;
const HOSTNAME = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const URL_KEYS = new Set(["obs.posthog.host", "obs.grafana.url", "obs.metabase.siteUrl"]);

function validUrl(value: string, production: boolean) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return !production && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Check a settings change against what would be stored afterwards. `current`
 * holds the resolved values (secrets included, server-side only). Returns a
 * short sentence for the first problem, or null.
 */
export function validateObservability(updates: Updates, current: Record<string, string | undefined>, production = process.env.NODE_ENV === "production"): string | null {
  for (const key of Object.keys(updates)) if (!ADMIN_KEYS.includes(key)) return "Unknown setting.";
  const after = (key: string): string | undefined => {
    const next = updates[key];
    if (next === undefined) return current[key];
    return next?.trim() || undefined;
  };
  const isOn = (key: string) => after(key) === "true";

  for (const [key, raw] of Object.entries(updates)) {
    const value = raw?.trim();
    if (!value) continue;
    if (key.endsWith(".enabled") || key === "obs.workspaceOverrides.allowed") {
      if (value !== "true" && value !== "false") return "Toggles must be on or off.";
    } else if (URL_KEYS.has(key)) {
      if (!validUrl(value, production)) return "Use a full https URL without a username or password.";
    } else if (key === "obs.consentMode") {
      if (!(CONSENT_MODES as readonly string[]).includes(value)) return "Choose opt-in, opt-out or none.";
    } else if (key === "obs.sentry.tracesSampleRate") {
      const rate = Number(value);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) return "The traces sample rate is a number from 0 to 1.";
    } else if (key === "obs.firebase.measurementId") {
      if (!/^G-[A-Z0-9]{4,20}$/.test(value)) return "A Firebase measurement ID looks like G-XXXXXXXXXX.";
    } else if (key === "obs.firebase.config") {
      try { if (value.length > 4000 || typeof JSON.parse(value) !== "object") return "The web app config must be a JSON object."; } catch { return "The web app config must be valid JSON."; }
    } else if (key === "obs.metabase.adminDashboardIds") {
      if (parseDashboardIds(value).length !== value.split(",").length) return "Dashboard ids are comma separated whole numbers.";
    } else if (key === "obs.grafana.dashboardPath") {
      if (!/^\/[A-Za-z0-9_\-./]{0,200}$/.test(value) || value.includes("..")) return "The dashboard path starts with / and has no spaces.";
    } else if (key === "obs.workspaceOverrides.providers") {
      const items = value.split(",").map((item) => item.trim()).filter(Boolean);
      if (items.some((item) => !(OVERRIDABLE_PROVIDERS as readonly string[]).includes(item))) return "Pick providers from the list.";
    } else if (key === "obs.workspaceOverrides.hostAllowlist") {
      if (value.split(",").map((item) => item.trim()).filter(Boolean).some((host) => !HOSTNAME.test(host))) return "The host allow-list takes comma separated host names.";
    } else if (value.length > 2000) return "That value is too long.";
  }

  for (const provider of PROVIDERS) {
    if (provider.enableKey && isOn(provider.enableKey)) {
      const missing = provider.required.find((key) => !after(key));
      if (missing) return `Add the ${provider.title} settings before turning it on.`;
    }
  }
  return null;
}

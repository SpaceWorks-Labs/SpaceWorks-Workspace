import "server-only";

import { getInstanceSettings } from "@/lib/instanceSettings";
import { parseAllowedDomains, type OAuthProvider } from "@/lib/oauthLinking";

export type AuthSettings = {
  google: { clientId: string; clientSecret: string } | null;
  github: { clientId: string; clientSecret: string } | null;
  apple: { clientId: string; teamId: string; keyId: string; privateKey: string } | null;
  allowSelfSignup: boolean;
  allowedEmailDomains: string[];
};

const TTL_MS = 30_000;
const KEY = Symbol.for("sww.authSettings");
type Entry = { at: number; value: Promise<AuthSettings> };
const store = globalThis as unknown as Record<symbol, Entry | undefined>;

const on = (value: string | undefined) => value === "true" || value === "1";

async function load(): Promise<AuthSettings> {
  const s = await getInstanceSettings([
    "google.enabled", "google.clientId", "google.clientSecret",
    "github.enabled", "github.clientId", "github.clientSecret",
    "apple.enabled", "apple.clientId", "apple.teamId", "apple.keyId", "apple.privateKey",
    "auth.allowSelfSignup", "auth.allowedEmailDomains",
  ]);
  const googleId = s["google.clientId"] ?? process.env.GOOGLE_CLIENT_ID;
  const googleSecret = s["google.clientSecret"] ?? process.env.GOOGLE_CLIENT_SECRET;
  const githubReady = s["github.clientId"] && s["github.clientSecret"];
  const appleReady = s["apple.clientId"] && s["apple.teamId"] && s["apple.keyId"] && s["apple.privateKey"];
  return {
    // Google predates the toggle: it stays on whenever keys exist unless switched off.
    google: googleId && googleSecret && s["google.enabled"] !== "false" && s["google.enabled"] !== "0" ? { clientId: googleId, clientSecret: googleSecret } : null,
    github: on(s["github.enabled"]) && githubReady ? { clientId: s["github.clientId"]!, clientSecret: s["github.clientSecret"]! } : null,
    apple: on(s["apple.enabled"]) && appleReady
      ? { clientId: s["apple.clientId"]!, teamId: s["apple.teamId"]!, keyId: s["apple.keyId"]!, privateKey: s["apple.privateKey"]! }
      : null,
    allowSelfSignup: on(s["auth.allowSelfSignup"]),
    allowedEmailDomains: parseAllowedDomains(s["auth.allowedEmailDomains"]),
  };
}

/** Instance sign-in settings, cached for 30 seconds per process. */
export function getAuthSettings(): Promise<AuthSettings> {
  const now = Date.now();
  const hit = store[KEY];
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = load();
  store[KEY] = { at: now, value };
  // A failed load must not be cached for the whole window.
  value.catch(() => { if (store[KEY]?.value === value) store[KEY] = undefined; });
  return value;
}

export function invalidateAuthSettings() {
  store[KEY] = undefined;
}

export async function enabledOAuthProviders(): Promise<OAuthProvider[]> {
  const s = await getAuthSettings();
  return (["google", "github", "apple"] as const).filter((p) => s[p] !== null);
}

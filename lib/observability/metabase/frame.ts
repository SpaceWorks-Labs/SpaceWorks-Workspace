import { parseOrigins } from "@/lib/observability/csp";

/** Origin of a URL, or null when it is not a valid https origin. */
export function httpsOrigin(value: string | null | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Whether the CSP lets this origin be framed: it must be listed in
 * `OBS_CSP_FRAME_ORIGINS`. Otherwise the UI shows a link-out instead of an iframe.
 */
export function frameAllowed(siteUrl: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const origin = httpsOrigin(siteUrl);
  if (!origin) return false;
  return parseOrigins(env.OBS_CSP_FRAME_ORIGINS).includes(origin.toLowerCase());
}

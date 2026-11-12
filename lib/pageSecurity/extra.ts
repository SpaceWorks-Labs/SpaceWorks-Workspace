/**
 * Extra CSP sources contributed by feature areas (observability, sign-in
 * providers). Entries are origins such as https://eu.i.posthog.com. Feature
 * agents edit this module, never the nonce logic in lib/pageSecurity.ts.
 * Must stay edge-safe: no database or server-only imports.
 */
import { observabilityCspSources } from "@/lib/observability/csp";

export type ExtraCspSources = { connect: string[]; frame: string[]; formAction: string[] };

/**
 * Origins sign-in providers may redirect a form post to. Google was already
 * allowed in lib/pageSecurity.ts; GitHub and Apple's authorize pages follow
 * the same redirect chain after the sign-in form submits.
 */
export const AUTH_FORM_ACTIONS: readonly string[] = ["https://github.com", "https://appleid.apple.com"];

export function extraCspSources(): ExtraCspSources {
  const obs = observabilityCspSources();
  return { connect: obs.connect, frame: obs.frame, formAction: [...AUTH_FORM_ACTIONS] };
}

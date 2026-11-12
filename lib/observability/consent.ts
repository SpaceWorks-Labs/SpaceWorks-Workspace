/**
 * Consent and browser privacy signals for PostHog, Clarity and Firebase.
 * Sentry is not gated here: it sends errors only, with no personal data.
 * Pure and client-safe.
 */
export const CONSENT_COOKIE = "sww_consent";
export const CONSENT_MODES = ["opt-in", "opt-out", "none"] as const;
export type ConsentMode = (typeof CONSENT_MODES)[number];
export type ConsentState = "granted" | "denied" | "unset";

export function parseConsentMode(value: string | null | undefined): ConsentMode {
  return (CONSENT_MODES as readonly string[]).includes(value ?? "") ? (value as ConsentMode) : "opt-in";
}

/** `analytics:1` is granted, `analytics:0` is denied; anything else is unset. */
export function parseConsentCookie(value: string | null | undefined): ConsentState {
  if (!value) return "unset";
  const entry = value.split("|").find((part) => part.startsWith("analytics:"));
  if (entry === "analytics:1") return "granted";
  if (entry === "analytics:0") return "denied";
  return "unset";
}

export function consentCookieValue(granted: boolean): string {
  return `analytics:${granted ? 1 : 0}`;
}

export type PrivacySignalSource = {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
  msDoNotTrack?: string | null;
};

/** Do Not Track or Global Privacy Control switched on. */
export function privacySignalActive(nav: PrivacySignalSource | null | undefined, win?: { doNotTrack?: string | null } | null): boolean {
  if (!nav) return false;
  const dnt = [nav.doNotTrack, nav.msDoNotTrack, win?.doNotTrack].some((value) => value === "1" || value === "yes");
  return dnt || nav.globalPrivacyControl === true;
}

export type GateInput = { mode: ConsentMode; consent: ConsentState; privacySignal: boolean; routeAllowed: boolean };

/** Every gate a consent-gated provider must pass. */
export function consentGatedAllowed({ mode, consent, privacySignal, routeAllowed }: GateInput): boolean {
  if (privacySignal || !routeAllowed) return false;
  if (mode === "none") return true;
  if (mode === "opt-out") return consent !== "denied";
  return consent === "granted";
}

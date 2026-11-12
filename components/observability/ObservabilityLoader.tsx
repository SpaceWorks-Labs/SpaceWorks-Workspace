"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { getObservabilityClientConfig } from "@/app/actions/workspaceObservability";
import { consentGatedAllowed, privacySignalActive, type ConsentMode, type ConsentState } from "@/lib/observability/consent";
import { EMPTY_PUBLIC_CONFIG, type PublicObsConfig } from "@/lib/observability/config";
import { isAnalyticsRouteAllowed, workspaceSlugFromPath } from "@/lib/observability/routes";
import { ConsentBanner } from "./ConsentBanner";

type Props = { nonce: string; config: PublicObsConfig; consentMode: ConsentMode; consent: ConsentState; signedIn: boolean };
type Started = { posthog: string | null; clarity: string | null; firebase: string | null };

/**
 * Starts the browser SDKs only when enabled and allowed, and re-initialises
 * when the user moves to another workspace. Sentry is not consent-gated;
 * PostHog, Clarity and Firebase need consent, no DNT/GPC and an allow-listed route.
 */
export function ObservabilityLoader({ nonce, config, consentMode, consent: initialConsent, signedIn }: Props) {
  const pathname = usePathname();
  const slug = workspaceSlugFromPath(pathname);
  const [initialSlug] = useState(slug);
  const [fetched, setFetched] = useState<{ slug: string; cfg: PublicObsConfig } | null>(null);
  const [consent, setConsent] = useState(initialConsent);
  const started = useRef<Started>({ posthog: null, clarity: null, firebase: null });
  const sentry = config.sentry;

  // The server resolved the first workspace; moving to another one fetches its config.
  const cfg = useMemo<PublicObsConfig>(() => {
    if (!signedIn || !slug) return { ...EMPTY_PUBLIC_CONFIG, sentry };
    if (fetched?.slug === slug) return { ...fetched.cfg, sentry: fetched.cfg.sentry ?? sentry };
    return slug === initialSlug ? config : { ...EMPTY_PUBLIC_CONFIG, sentry };
  }, [signedIn, slug, fetched, initialSlug, config, sentry]);

  useEffect(() => {
    if (!cfg.sentry) return;
    void import("@/lib/observability/sentry/client").then((m) => m.initClientSentry(cfg.sentry!)).catch(() => undefined);
  }, [cfg.sentry]);

  useEffect(() => {
    if (!signedIn || !slug || slug === initialSlug || fetched?.slug === slug) return;
    let cancelled = false;
    void getObservabilityClientConfig(slug).then((next) => { if (!cancelled) setFetched({ slug, cfg: next }); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [signedIn, slug, initialSlug, fetched]);

  // Server and first paint assume a privacy signal, so nothing consent-gated starts before it is read.
  const privacySignal = useSyncExternalStore(
    () => () => undefined,
    () => privacySignalActive(navigator as Navigator & { globalPrivacyControl?: boolean }, window as unknown as { doNotTrack?: string | null }),
    () => true,
  );
  const allowed = signedIn && consentGatedAllowed({ mode: consentMode, consent, privacySignal, routeAllowed: isAnalyticsRouteAllowed(pathname) });

  useEffect(() => {
    let cancelled = false;
    const s = started.current;
    void (async () => {
      const ph = allowed && cfg.posthog ? cfg.posthog : null;
      if (!ph && s.posthog) { (await import("@/lib/observability/posthog/client")).stopPosthog(); s.posthog = null; }
      if (ph && !cancelled) {
        const m = await import("@/lib/observability/posthog/client");
        if (s.posthog !== cfg.scopeKey) { s.posthog = cfg.scopeKey; await m.startPosthog(ph, pathname); } else m.capturePosthogPageview(pathname);
      }
      const clarity = allowed && cfg.clarity ? cfg.clarity : null;
      const key = clarity ? `${cfg.scopeKey}:${clarity.projectId}` : null;
      if (s.clarity && s.clarity !== key) { (await import("@/lib/observability/clarity/loader")).stopClarity(); s.clarity = null; }
      if (clarity && key && !s.clarity && !cancelled) { s.clarity = key; (await import("@/lib/observability/clarity/loader")).startClarity(clarity.projectId, nonce); }
      const fb = allowed && cfg.firebase ? cfg.firebase : null;
      const fbLoader = fb || s.firebase ? await import("@/lib/observability/firebase/loader") : null;
      if (!fb && s.firebase) { fbLoader!.stopFirebase(); s.firebase = null; }
      if (fb && fbLoader && !cancelled) {
        if (s.firebase) fbLoader.firebasePageview(pathname); else { s.firebase = fb.measurementId; fbLoader.startFirebase(fb.measurementId, nonce, pathname); }
      }
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [allowed, cfg, pathname, nonce]);

  const gatedActive = Boolean(cfg.posthog || cfg.clarity || cfg.firebase);
  const showBanner = signedIn && consentMode === "opt-in" && consent === "unset" && gatedActive && !privacySignal && isAnalyticsRouteAllowed(pathname);
  return showBanner ? <ConsentBanner onChoose={(granted) => setConsent(granted ? "granted" : "denied")} /> : null;
}

import { FIREBASE_MEASUREMENT_PATTERN } from "../patterns";
import { normalizePath } from "../routes";

type W = Window & { dataLayer?: unknown[]; [key: `ga-disable-${string}`]: boolean | undefined };

let script: HTMLScriptElement | null = null;
let currentId: string | null = null;

function gtag(...args: unknown[]) {
  const w = window as unknown as W;
  (w.dataLayer = w.dataLayer ?? []).push(args);
}

/**
 * Google Analytics (Firebase) through a nonce'd gtag loader, no SDK. Consent
 * Mode starts denied and is granted only after our own gates passed. No
 * Google signals, no ad personalisation, IP anonymised, no user_id.
 */
export function startFirebase(measurementId: string, nonce: string, path: string): void {
  if (!FIREBASE_MEASUREMENT_PATTERN.test(measurementId)) return;
  const w = window as unknown as W;
  w[`ga-disable-${measurementId}`] = false;
  if (!script) {
    gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });
    gtag("js", new Date());
    script = document.createElement("script");
    script.async = true;
    script.nonce = nonce;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
  }
  if (currentId !== measurementId) {
    gtag("config", measurementId, { allow_google_signals: false, allow_ad_personalization_signals: false, anonymize_ip: true, send_page_view: false });
    currentId = measurementId;
  }
  gtag("consent", "update", { analytics_storage: "granted" });
  firebasePageview(path);
}

export function firebasePageview(path: string): void {
  gtag("event", "page_view", { page_path: normalizePath(path), page_location: `${window.location.origin}${normalizePath(path)}`, page_title: "" });
}

export function stopFirebase(): void {
  if (currentId) (window as unknown as W)[`ga-disable-${currentId}`] = true;
  gtag("consent", "update", { analytics_storage: "denied" });
}

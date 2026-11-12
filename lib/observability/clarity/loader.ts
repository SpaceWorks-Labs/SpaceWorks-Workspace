import { CLARITY_PROJECT_PATTERN } from "../patterns";

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[][] };
type W = Window & { clarity?: ClarityFn };

let script: HTMLScriptElement | null = null;

/**
 * Load Microsoft Clarity with the page's CSP nonce. Call only after every gate
 * (consent, DNT/GPC, route, workspace opt-in) has passed. No identify call.
 * Owners should also set masking to Strict in the Clarity dashboard.
 */
export function startClarity(projectId: string, nonce: string): void {
  if (!CLARITY_PROJECT_PATTERN.test(projectId) || script) return;
  const w = window as W;
  w.clarity = w.clarity ?? (((...args: unknown[]) => { (w.clarity!.q = w.clarity!.q ?? []).push(args); }) as ClarityFn);
  w.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "granted" });
  script = document.createElement("script");
  script.async = true;
  script.nonce = nonce;
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(projectId)}`;
  document.head.appendChild(script);
}

export function stopClarity(): void {
  const w = window as W;
  try { w.clarity?.("stop"); } catch { /* not loaded yet */ }
  script?.remove();
  script = null;
}

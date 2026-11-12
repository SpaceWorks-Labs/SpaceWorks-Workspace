import type { PublicObsConfig } from "../config";
import { isObsEvent } from "../events";
import { normalizePath } from "../routes";
import { sanitizePosthogProperties } from "./sanitize";

type Handle = { capture: (name: string, props?: Record<string, unknown>) => void; stop: () => void };
let active: Handle | null = null;
let counter = 0;

/**
 * Start PostHog through the same-origin tunnel. No autocapture, no session
 * recording, memory-only persistence, manual templated page views.
 */
export async function startPosthog(cfg: NonNullable<PublicObsConfig["posthog"]>, path: string): Promise<void> {
  stopPosthog();
  const { default: posthog } = await import("posthog-js");
  const name = `sww${++counter}`;
  const ph = posthog.init(cfg.key, {
    api_host: "/api/obs/ph",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_web_experiments: true,
    advanced_disable_flags: true,
    person_profiles: "identified_only",
    respect_dnt: true,
    mask_all_text: true,
    persistence: "memory",
    save_referrer: false,
    ip: false,
    request_headers: cfg.tunnelToken ? { "x-sww-obs": cfg.tunnelToken } : {},
    sanitize_properties: (properties) => sanitizePosthogProperties(properties) as typeof properties,
  }, name);
  ph.identify(cfg.distinctId);
  if (cfg.groupId) ph.group("workspace", cfg.groupId);
  const capture = (event: string, props?: Record<string, unknown>) => { if (isObsEvent(event)) ph.capture(event, props); };
  active = { capture, stop: () => { ph.opt_out_capturing(); ph.reset(); } };
  capturePosthogPageview(path);
}

export function capturePosthogPageview(path: string): void {
  active?.capture("$pageview", { $current_url: normalizePath(path) });
}

export function trackObsEvent(name: string): void {
  active?.capture(name);
}

export function stopPosthog(): void {
  active?.stop();
  active = null;
}

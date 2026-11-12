import type { PublicObsConfig } from "../config";
import { scrubBreadcrumb, scrubEvent } from "./scrub";

/** Browser Sentry through the same-origin tunnel. Errors only: no replay, no profiling, no tracing. */
export async function initClientSentry(cfg: NonNullable<PublicObsConfig["sentry"]>): Promise<void> {
  const Sentry = await import("@sentry/browser");
  if (Sentry.getClient()) return;
  Sentry.init({
    dsn: cfg.dsn,
    tunnel: "/api/obs/sentry",
    environment: cfg.environment,
    release: cfg.release,
    // Sentry 11 has no sendDefaultPii; its dataCollection defaults collect data, so switch every category off.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, queues: false, stackFrameVariables: false, genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false } },
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
}

/** Used by the error boundaries; does nothing unless Sentry was initialised. */
export function captureClientException(error: unknown): void {
  void import("@sentry/browser")
    .then((Sentry) => { if (Sentry.getClient()) Sentry.captureException(error); })
    .catch(() => undefined);
}

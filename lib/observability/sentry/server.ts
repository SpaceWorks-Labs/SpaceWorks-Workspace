import "server-only";
import { getObsSettings } from "../keys";
import { appRelease } from "../release";
import { parseDsn } from "./dsn";
import { scrubBreadcrumb, scrubEvent, scrubUrl } from "./scrub";

const FLAG = Symbol.for("sww.sentry.init");
type Flagged = typeof globalThis & { [FLAG]?: boolean };

/**
 * Initialise the Node SDK from instance settings (database first, then env).
 * Never throws: observability must not block boot. A DSN change needs a restart.
 * Tracing and profiling stay off, so OpenTelemetry is not installed.
 */
export async function initServerSentry(role: "web" | "worker" | "beat" = "web"): Promise<boolean> {
  const flagged = globalThis as Flagged;
  if (flagged[FLAG]) return true;
  try {
    const settings = await getObsSettings();
    const { enabled, dsn, environment } = settings.sentry;
    if (!enabled || !parseDsn(dsn)) return false;
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn: dsn!,
      environment,
      release: appRelease(),
      // Sentry 11 has no sendDefaultPii; its dataCollection defaults collect data, so switch every category off.
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, queues: false, stackFrameVariables: false, genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false } },
      tracesSampleRate: 0,
      enableOpenTelemetrySetup: false,
      initialScope: { tags: { process: role } },
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    });
    flagged[FLAG] = true;
    return true;
  } catch {
    return false;
  }
}

/** Next.js `onRequestError`: report with a templated path, route and no headers or bodies. */
export async function captureRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath?: string; routeType?: string; routerKind?: string },
): Promise<void> {
  if (!(globalThis as Flagged)[FLAG]) return;
  try {
    const Sentry = await import("@sentry/node");
    Sentry.captureException(error, {
      tags: { route: context.routePath ?? "unknown", route_type: context.routeType ?? "unknown", method: request.method },
      contexts: { request: { path: scrubUrl(request.path) } },
    });
  } catch {
    // Reporting is best effort.
  }
}

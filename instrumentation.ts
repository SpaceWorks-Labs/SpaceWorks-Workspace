export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeEnvironment } = await import("@/lib/env");
    validateRuntimeEnvironment();
    // Never blocks boot: failures are swallowed inside.
    await (await import("@/lib/observability/sentry/server")).initServerSentry("web");
    if (process.env.NODE_ENV !== "production" && !process.env.REDIS_URL && process.env.JOBS_INPROCESS === "true") {
      const { startOutboxWorker } = await import("@/lib/outboxWorker");
      startOutboxWorker();
    }
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath?: string; routeType?: string; routerKind?: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await (await import("@/lib/observability/sentry/server")).captureRequestError(error, request, context);
}

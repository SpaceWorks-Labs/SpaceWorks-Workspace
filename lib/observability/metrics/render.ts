import "server-only";
import { refreshGauges } from "./gauges";
import { getMetrics } from "./registry";

const TTL_MS = 15_000;
let cached: { at: number; body: string; contentType: string } | null = null;

export function resetRenderCache() {
  cached = null;
}

/** Prometheus text exposition, cached for about 15 seconds. */
export async function renderMetrics() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached;
  await refreshGauges();
  const { registry } = getMetrics();
  cached = { at: Date.now(), body: await registry.metrics(), contentType: registry.contentType };
  return cached;
}

/** Worker and beat processes expose only process, queue-result and schedule metrics. */
export async function renderProcessMetrics() {
  const { registry } = getMetrics();
  return { body: await registry.metrics(), contentType: registry.contentType };
}

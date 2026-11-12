import "server-only";
import { getMetrics, httpGroup } from "./registry";

type Handler<Args extends unknown[]> = (request: Request, ...rest: Args) => Promise<Response> | Response;

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** Opt-in wrapper that counts and times a Route Handler. Labels are bounded: group, method and status class only. */
export function withMetrics<Args extends unknown[]>(handler: Handler<Args>): Handler<Args> {
  return async (request, ...rest) => {
    const started = process.hrtime.bigint();
    const group = httpGroup(new URL(request.url).pathname);
    const method = METHODS.has(request.method.toUpperCase()) ? request.method.toUpperCase() : "OTHER";
    let status = 500;
    try {
      const response = await handler(request, ...rest);
      status = response.status;
      return response;
    } finally {
      const labels = { group, method, status_class: `${Math.floor(status / 100)}xx` };
      const metrics = getMetrics();
      metrics.httpRequests.inc(labels);
      metrics.httpDuration.observe(labels, Number(process.hrtime.bigint() - started) / 1e9);
    }
  };
}

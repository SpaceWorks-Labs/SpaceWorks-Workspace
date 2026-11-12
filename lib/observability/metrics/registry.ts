import "server-only";
import { readFileSync } from "node:fs";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

const KEY = Symbol.for("sww.metrics");

/** Fixed label values. Nothing user-controlled ever becomes a label. */
export const HTTP_GROUPS = ["api_v1", "auth", "files", "internal", "realtime", "other"] as const;
export type HttpGroup = (typeof HTTP_GROUPS)[number];
export const JOB_QUEUES = ["outbox", "scheduled", "sync", "monitor", "documents"] as const;

export type Metrics = {
  registry: Registry;
  httpRequests: Counter<"group" | "method" | "status_class">;
  httpDuration: Histogram<"group" | "method" | "status_class">;
  workspaces: Gauge<"state">;
  users: Gauge<"state">;
  activeUsers: Gauge<"window">;
  outbox: Gauge<"status">;
  outboxOldest: Gauge;
  dbUp: Gauge;
  redisUp: Gauge;
  jobs: Gauge<"queue" | "state">;
  jobResults: Counter<"queue" | "result">;
  beatSchedules: Gauge;
};

function version() {
  try { return readFileSync("VERSION", "utf8").trim() || "unknown"; } catch { return process.env.APP_VERSION || "unknown"; }
}

function build(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  new Gauge({ name: "sww_build_info", help: "Build information.", labelNames: ["version"], registers: [registry] }).set({ version: version() }, 1);
  const reg = [registry];
  return {
    registry,
    httpRequests: new Counter({ name: "sww_http_requests_total", help: "HTTP requests handled by instrumented routes.", labelNames: ["group", "method", "status_class"], registers: reg }),
    httpDuration: new Histogram({ name: "sww_http_request_duration_seconds", help: "HTTP request duration in seconds.", labelNames: ["group", "method", "status_class"], buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], registers: reg }),
    workspaces: new Gauge({ name: "sww_workspaces", help: "Workspaces by status.", labelNames: ["state"], registers: reg }),
    users: new Gauge({ name: "sww_users", help: "Users by state.", labelNames: ["state"], registers: reg }),
    activeUsers: new Gauge({ name: "sww_active_users", help: "Users seen inside the window (presence is written at most every 5 minutes).", labelNames: ["window"], registers: reg }),
    outbox: new Gauge({ name: "sww_outbox_messages", help: "Email outbox rows by status.", labelNames: ["status"], registers: reg }),
    outboxOldest: new Gauge({ name: "sww_outbox_oldest_pending_age_seconds", help: "Age of the oldest pending outbox row.", registers: reg }),
    dbUp: new Gauge({ name: "sww_db_up", help: "1 when PostgreSQL answers.", registers: reg }),
    redisUp: new Gauge({ name: "sww_redis_up", help: "1 when Redis answers.", registers: reg }),
    jobs: new Gauge({ name: "sww_jobs", help: "Background jobs by queue and state.", labelNames: ["queue", "state"], registers: reg }),
    jobResults: new Counter({ name: "sww_job_results_total", help: "Jobs finished by this process.", labelNames: ["queue", "result"], registers: reg }),
    beatSchedules: new Gauge({ name: "sww_beat_schedules", help: "Schedules registered by the beat process.", registers: reg }),
  };
}

type Global = typeof globalThis & { [KEY]?: Metrics };

export function getMetrics(): Metrics {
  const store = globalThis as Global;
  return (store[KEY] ??= build());
}

export function httpGroup(pathname: string): HttpGroup {
  if (pathname.startsWith("/api/v1/")) return "api_v1";
  if (pathname.startsWith("/api/auth/") || pathname.startsWith("/api/account/")) return "auth";
  if (pathname.startsWith("/api/files")) return "files";
  if (pathname.startsWith("/api/internal/")) return "internal";
  if (pathname.startsWith("/api/realtime")) return "realtime";
  return "other";
}

import "server-only";
import { prisma } from "@/lib/db";
import { getJobsHealth } from "@/lib/queue/admin";
import { getQueues } from "@/lib/queue/client";
import { getMetrics, JOB_QUEUES } from "./registry";

const TTL_MS = 15_000;
const DAY_MS = 86_400_000;
const WORKSPACE_STATES = ["PENDING", "ACTIVE", "REJECTED", "SUSPENDED"] as const;
const OUTBOX_STATES = ["PENDING", "PROCESSING", "SENT", "FAILED"] as const;
const JOB_STATES = ["waiting", "active", "completed", "failed", "delayed", "paused"] as const;

let refreshedAt = 0;
let inflight: Promise<void> | null = null;

/** Test hook: forget the cached refresh. */
export function resetGaugeCache() {
  refreshedAt = 0;
  inflight = null;
}

async function refreshDatabase() {
  const m = getMetrics();
  try {
    const now = Date.now();
    const [workspaces, users, disabled, day, week, outbox, oldest] = await Promise.all([
      prisma.workspace.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.user.count(),
      prisma.user.count({ where: { disabledAt: { not: null } } }),
      prisma.user.count({ where: { lastSeenAt: { gte: new Date(now - DAY_MS) }, disabledAt: null } }),
      prisma.user.count({ where: { lastSeenAt: { gte: new Date(now - 7 * DAY_MS) }, disabledAt: null } }),
      prisma.outboxMessage.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.outboxMessage.aggregate({ where: { status: "PENDING" }, _min: { createdAt: true } }),
    ]);
    for (const state of WORKSPACE_STATES) m.workspaces.set({ state: state.toLowerCase() }, workspaces.find((row) => row.status === state)?._count._all ?? 0);
    m.users.set({ state: "active" }, users - disabled);
    m.users.set({ state: "disabled" }, disabled);
    m.activeUsers.set({ window: "24h" }, day);
    m.activeUsers.set({ window: "7d" }, week);
    for (const status of OUTBOX_STATES) m.outbox.set({ status: status.toLowerCase() }, outbox.find((row) => row.status === status)?._count._all ?? 0);
    const created = oldest._min.createdAt;
    m.outboxOldest.set(created ? Math.max(0, (now - created.getTime()) / 1000) : 0);
    m.dbUp.set(1);
  } catch {
    m.dbUp.set(0);
  }
}

async function refreshRedis() {
  const m = getMetrics();
  try {
    const client = await getQueues().scheduled.client;
    await client.get("sww:metrics:ping");
    m.redisUp.set(1);
    const health = await getJobsHealth();
    for (const queue of JOB_QUEUES) {
      const counts = health.find((row) => row.name === queue)?.counts ?? {};
      for (const state of JOB_STATES) m.jobs.set({ queue, state }, Number(counts[state] ?? 0));
    }
  } catch {
    m.redisUp.set(0);
  }
}

/** Refresh the cheap DB and queue gauges at most once every 15 seconds. */
export function refreshGauges(): Promise<void> {
  if (Date.now() - refreshedAt < TTL_MS) return Promise.resolve();
  return (inflight ??= Promise.all([refreshDatabase(), refreshRedis()])
    .then(() => { refreshedAt = Date.now(); })
    .finally(() => { inflight = null; }));
}

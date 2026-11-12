import "server-only";

import { prisma } from "@/lib/db";
import { getEmailSettings } from "@/lib/instanceSettings";
import { appRelease } from "@/lib/observability/release";
import { getOutboxHealth } from "@/lib/outbox";
import { getJobsHealth } from "@/lib/queue/admin";
import { isRedisConfigured } from "@/lib/redis";
import { storageConfigured } from "@/lib/storage";
import { heartbeatLabel } from "./compute";
import type { QueueHealth, SystemHealth } from "./types";

/**
 * A heartbeat within this window reads as "Recent". Heartbeats are written when
 * work succeeds (an email delivered, a monitor round), so an older one can mean
 * idle rather than down.
 */
const HEARTBEAT_FRESH_MS = 15 * 60_000;

async function database(): Promise<SystemHealth["database"]> {
  const started = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

/** Queue counts from BullMQ (the same safe projection as /admin/jobs). Null when Redis is off or unreachable. */
async function queues(): Promise<QueueHealth[] | null> {
  if (!isRedisConfigured()) return null;
  try {
    const health = await getJobsHealth();
    return health.map((queue) => ({
      name: queue.name,
      waiting: Number(queue.counts.waiting ?? 0),
      active: Number(queue.counts.active ?? 0),
      delayed: Number(queue.counts.delayed ?? 0),
      failed: Number(queue.counts.failed ?? 0),
      paused: queue.paused,
    }));
  } catch {
    return null;
  }
}

/** Reuses existing probes and settings only; no new network checks. */
export async function loadSystemHealth(now = new Date()): Promise<SystemHealth> {
  const [db, jobQueues, outbox, beats, email] = await Promise.all([
    database(),
    queues(),
    getOutboxHealth().catch(() => null),
    prisma.operationalHeartbeat.findMany({ select: { key: true, lastSucceededAt: true }, orderBy: { key: "asc" } }).catch(() => []),
    getEmailSettings().catch(() => null),
  ]);
  return {
    version: appRelease().replace(/^space-works@/, ""),
    database: db,
    redis: { configured: isRedisConfigured(), reachable: jobQueues !== null },
    queues: jobQueues,
    outbox: {
      pending: outbox?.counts.PENDING ?? 0,
      processing: outbox?.counts.PROCESSING ?? 0,
      failed: outbox?.counts.FAILED ?? 0,
      sent: outbox?.counts.SENT ?? 0,
      oldestPendingAt: outbox?.oldestPendingAt?.toISOString() ?? null,
    },
    heartbeats: beats.map((beat) => ({
      key: beat.key,
      label: heartbeatLabel(beat.key),
      lastSucceededAt: beat.lastSucceededAt?.toISOString() ?? null,
      fresh: Boolean(beat.lastSucceededAt && now.getTime() - beat.lastSucceededAt.getTime() < HEARTBEAT_FRESH_MS),
    })),
    storageConfigured: storageConfigured(),
    emailConfigured: Boolean(email && (email.host || email.service)),
  };
}

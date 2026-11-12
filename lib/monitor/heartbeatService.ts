import "server-only";

import { randomToken, sha256Hex } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { claimOnce, withinLimit } from "@/lib/monitor/coord";
import { isOverdue, nextExpectedAt, parsePingAction, pingOutcome } from "@/lib/monitor/heartbeat";
import { EventBatch, monitorScope, monitorUrl } from "@/lib/monitor/notify";
import { recordOutcome } from "@/lib/monitor/runner";
import { heartbeatConfigSchema, type HeartbeatConfig } from "@/lib/monitor/schemas";

/** Heartbeat tokens: 32 random bytes (base64url); only sha256 + the last 4 characters are stored. */
export function newHeartbeatToken() {
  const token = randomToken(32);
  return { token, hash: sha256Hex(token), hint: token.slice(-4) };
}

export const PING_RATE_LIMIT_PER_MIN = 10;
const MAX_BODY = 10 * 1024;

function heartbeatConfig(config: unknown): HeartbeatConfig {
  const parsed = heartbeatConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : heartbeatConfigSchema.parse({});
}

export type PingResult = { status: 200 | 404 | 429; body: string };

/** Handle one ping. Unknown tokens and unknown suffixes answer 404 (no hint whether the token exists). */
export async function handlePing(input: { token: string; action?: string; body?: string | null; sourceIp?: string | null; runId?: string | null; now?: Date }): Promise<PingResult> {
  const notFound: PingResult = { status: 404, body: "Not found" };
  const action = parsePingAction(input.action);
  if (!action || typeof input.token !== "string" || input.token.length < 20 || input.token.length > 100) return notFound;
  const monitor = await prisma.monitor.findUnique({ where: { heartbeatTokenHash: sha256Hex(input.token), workspace: { status: "ACTIVE", archivedAt: null } }, select: { id: true, type: true, enabled: true, config: true } });
  if (!monitor || monitor.type !== "HEARTBEAT") return notFound;
  if (!(await withinLimit(`hb:${monitor.id}`, PING_RATE_LIMIT_PER_MIN, 60_000))) return { status: 429, body: "Too many pings. Send at most 10 a minute." };
  const now = input.now ?? new Date();
  const runId = input.runId && /^[0-9a-f-]{8,64}$/i.test(input.runId) ? input.runId : null;

  const batches: EventBatch[] = [];
  const accepted = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Monitor" WHERE "id" = ${monitor.id} FOR UPDATE`;
    // Recheck after the lock: a concurrent token rotation invalidates this ping.
    const current = await tx.monitor.findFirst({ where: { id: monitor.id, heartbeatTokenHash: sha256Hex(input.token) } });
    if (!current) return false;
    let durationMs: number | null = null;
    if (action.kind !== "START" && action.kind !== "LOG") {
      const start = await tx.heartbeatPing.findFirst({ where: { monitorId: monitor.id, kind: "START", ...(runId ? { runId } : {}) }, orderBy: { receivedAt: "desc" } });
      const finished = start ? await tx.heartbeatPing.count({ where: { monitorId: monitor.id, kind: { in: ["SUCCESS", "FAIL", "EXIT"] }, receivedAt: { gte: start.receivedAt }, ...(runId ? { runId } : {}) } }) : 1;
      if (start && !finished) durationMs = Math.max(0, now.getTime() - start.receivedAt.getTime());
    }
    await tx.heartbeatPing.create({ data: { monitorId: monitor.id, receivedAt: now, kind: action.kind, exitCode: action.exitCode, runId, durationMs, sourceIp: input.sourceIp?.slice(0, 64) ?? null, body: input.body ? Buffer.from(input.body).subarray(0, MAX_BODY).toString("utf8") : null } });
    if (!current.enabled) return true;
    const outcome = pingOutcome(action);
    if (!outcome) return true;
    const config = heartbeatConfig(current.config);
    await recordOutcome(monitor.id, outcome === "UP" ? { status: "UP", latencyMs: durationMs } : { status: "DOWN", latencyMs: durationMs, error: "FAILED", message: action.kind === "EXIT" ? `The job exited with status ${action.exitCode}.` : "The job reported a failure." }, now, { tx, batches, heartbeat: { lastPingAt: now, expectedNextAt: nextExpectedAt(config, now) } });
    return true;
  }, { timeout: 20000 });
  for (const batch of batches) await batch.afterCommit();
  return accepted ? { status: 200, body: "OK" } : notFound;
}

/** Mark overdue heartbeats DOWN (one sample per missed period) and runs that never finished. */
export async function sweepHeartbeats(now = new Date()): Promise<number> {
  const candidates = await prisma.monitor.findMany({
    where: { workspace: { status: "ACTIVE", archivedAt: null }, type: "HEARTBEAT", enabled: true, expectedNextAt: { lte: now } },
    select: { id: true, name: true, tags: true, useWorkspaceRules: true, config: true, expectedNextAt: true, lastPingAt: true, lastStatus: true, workspace: { select: { id: true, slug: true } } },
    take: 200,
  });
  let missed = 0;
  for (const monitor of candidates) {
    const config = heartbeatConfig(monitor.config);
    if (!isOverdue(monitor.expectedNextAt, config.graceSec, now)) continue;

    const expectedAt = monitor.expectedNextAt!;
    const result = await recordOutcome(monitor.id, {
      status: "DOWN",
      latencyMs: null,
      error: "MISSED",
      message: monitor.lastPingAt ? "No ping arrived in the expected window." : "No ping has arrived yet.",
      meta: { expectedAt: expectedAt.toISOString() },
    }, now, { expectedNextAt: monitor.expectedNextAt!, heartbeat: { expectedNextAt: nextExpectedAt(config, now) } });
    if (result) missed += 1;
    if (result && result.previousStatus !== "DOWN" && result.status === "DOWN") {
      await dispatch(monitor.workspace.id, {
        type: "heartbeat.missed",
        title: `${monitor.name} missed its heartbeat`,
        body: monitor.lastPingAt ? `Last ping ${monitor.lastPingAt.toISOString()}.` : "No ping has arrived yet.",
        url: monitorUrl(monitor.workspace, monitor.id),
        resource: { type: "monitor", id: monitor.id },
        scope: monitorScope(monitor),
        dedupeKey: `heartbeat:${monitor.id}:missed:${expectedAt.toISOString()}`,
        useWorkspaceRules: monitor.useWorkspaceRules,
        occurredAt: now,
        data: { monitorId: monitor.id, lastPingAt: monitor.lastPingAt?.toISOString() ?? null, expectedAt: expectedAt.toISOString() },
      }).catch(() => undefined);
    }
  }

  const longRunners = await prisma.monitor.findMany({ where: { workspace: { status: "ACTIVE", archivedAt: null }, type: "HEARTBEAT", enabled: true }, select: { id: true, config: true }, take: 500 });
  for (const monitor of longRunners) {
    const config = heartbeatConfig(monitor.config);
    if (!config.maxRunSec) continue;
    const last = await prisma.heartbeatPing.findFirst({ where: { monitorId: monitor.id, kind: { in: ["START", "SUCCESS", "FAIL", "EXIT"] } }, orderBy: { receivedAt: "desc" }, select: { id: true, kind: true, receivedAt: true } });
    if (!last || last.kind !== "START" || now.getTime() - last.receivedAt.getTime() <= config.maxRunSec * 1000) continue;
    if (!(await claimOnce(`runlong:${last.id}`, 7 * 86_400_000))) continue;
    await recordOutcome(monitor.id, { status: "DOWN", latencyMs: null, error: "RUN_TOO_LONG", message: `The run started ${Math.round((now.getTime() - last.receivedAt.getTime()) / 60_000)} minutes ago and has not finished.` }, now);
  }
  return missed;
}

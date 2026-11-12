import "server-only";
import { DelayedError, UnrecoverableError, Worker, type Job, type Processor } from "bullmq";
import { prisma } from "@/lib/db";
import { deliverOutboxBatch } from "@/lib/outbox";
import { recordHeartbeatSuccess } from "@/lib/operationalHeartbeat";
import { SCHEDULED_JOBS } from "@/lib/scheduled";
import { describeOperationalError } from "@/lib/redactSensitiveText";
import { recordJobResult } from "@/lib/observability/metrics/jobs";
import { queueConnection } from "./client";
import { QUEUE_NAMES, queueConcurrency, type QueueJob } from "./definitions";

export async function processQueueJob(job: Job<QueueJob>, token?: string) {
  const data = job.data;
  if (data.kind === "secrets-rotation") {
    await (await import("@/lib/secrets/rotation")).runKeyRotation(data.rotationId); return;
  }
  if (data.kind === "google-meet") {
    await (await import("@/lib/calendar/google")).finishMeetLink(data.bindingId); return;
  }
  if (data.kind === "registered") {
    const definition = SCHEDULED_JOBS.find(item => item.area === data.area);
    if (!definition) throw new UnrecoverableError("Job registration removed. Remove this job.");
    await definition.run(new Date());
    return;
  }
  if (data.kind !== "outbox" || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.outboxId)) throw new UnrecoverableError("Invalid job definition.");
  await deliverOutboxBatch(1, { ids: [data.outboxId] });
  const row = await prisma.outboxMessage.findUnique({ where: { id: data.outboxId }, select: { status: true, availableAt: true, lockedAt: true, lastError: true } });
  if (!row || row.status === "SENT") {
    await recordHeartbeatSuccess("outbox-scheduler", { sent: 1 });
    return;
  }
  if (row.status === "FAILED") throw new UnrecoverableError(row.lastError || "Delivery failed. Check email outbox.");
  const due = row.status === "PROCESSING" ? (row.lockedAt?.getTime() ?? Date.now()) + 15 * 60_000 : row.availableAt.getTime();
  // SQL owns delivery retry timing, including provider Retry-After. Never complete a pending delivery.
  if (due > Date.now()) {
    await job.moveToDelayed(due, token);
    throw new DelayedError();
  }
  throw new Error("Delivery pending. Retrying.");
}

export function createWorkers(options: { prefix?: string; redisUrl?: string; processor?: Processor<QueueJob> } = {}) {
  const workers = QUEUE_NAMES.map(name => {
    const worker = new Worker<QueueJob>(name, async (job, token) => {
      try { return await (options.processor ?? processQueueJob)(job, token); }
      catch (error) {
        if (error instanceof DelayedError) throw error;
        // BullMQ stores thrown messages. Strip provider responses, URLs, bodies and credentials.
        if (error instanceof UnrecoverableError) throw new UnrecoverableError(describeOperationalError(error));
        throw new Error(describeOperationalError(error));
      }
    }, { connection: queueConnection(true, options.redisUrl), prefix: options.prefix ?? process.env.JOBS_QUEUE_PREFIX ?? "sww:jobs", concurrency: queueConcurrency(name), maxStalledCount: 2 });
    worker.on("error", () => console.error(`[queue] ${name} worker error`));
    worker.on("failed", () => { recordJobResult(name, "failed"); console.error(`[queue] ${name} job failed`); });
    worker.on("completed", () => recordJobResult(name, "completed"));
    return worker;
  });
  return {
    workers,
    ready: () => Promise.all(workers.map(worker => worker.waitUntilReady())),
    // close() stops new claims and waits for current handlers, including their final SQL updates.
    close: () => Promise.all(workers.map(worker => worker.close())),
  };
}

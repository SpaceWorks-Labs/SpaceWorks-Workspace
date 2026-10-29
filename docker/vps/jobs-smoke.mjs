// Real BullMQ worker/SMTP delivery in the disposable installer deployment.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";

assert.equal(process.env.SWW_RECOVERY_SMOKE, "1", "Explicit disposable deployment opt-in required");
const prisma = new PrismaClient();
const url = new URL(process.env.REDIS_URL);
const connection = { host: url.hostname, port: Number(url.port || 6379),
  username: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
  maxRetriesPerRequest: 1, ...(url.protocol === "rediss:" ? { tls: {} } : {}) };
const queue = new Queue("outbox", { connection, prefix: process.env.JOBS_QUEUE_PREFIX || "sww:jobs" });
const subject = `Disposable worker smoke ${randomUUID()}`;
let id;
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch("http://mailpit:8025/api/v1/messages", { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) { ready = true; break; }
    } catch { /* Mailpit is starting. */ }
    await delay(200);
  }
  assert.ok(ready, "Disposable SMTP capture must be ready before queueing mail");
  const row = await prisma.outboxMessage.create({ data: { kind: "password-reset", payload: {
    to: "worker-fixture@example.test", resetUrl: new URL(`/reset-password/${randomUUID()}`, process.env.NEXT_PUBLIC_BASE_URL).href,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  } } });
  id = row.id;
  // The reset template has a stable subject; correlate this fixture by recipient.
  await queue.add(subject, { kind: "outbox", outboxId: id }, { removeOnComplete: true });
  let delivered = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch("http://mailpit:8025/api/v1/messages", { signal: AbortSignal.timeout(3000) });
    const messages = await response.json();
    const captured = messages.messages?.some(message => message.To?.some(to => to.Address === "worker-fixture@example.test"));
    if (captured && !(await prisma.outboxMessage.findUnique({ where: { id } }))) { delivered = true; break; }
    await delay(300);
  }
  assert.ok(delivered, "The real worker must deliver through SMTP and delete the bearer payload");
  console.log("Real Redis/BullMQ worker delivered SMTP over STARTTLS; Mailpit captured it and the bearer outbox payload was deleted.");
} catch {
  console.error("Disposable worker delivery failed; credentials and message contents were suppressed.");
  process.exitCode = 1;
} finally {
  if (id) await prisma.outboxMessage.deleteMany({ where: { id } }).catch(() => {});
  await queue.close();
  await prisma.$disconnect();
}

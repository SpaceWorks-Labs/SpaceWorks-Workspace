import { validateRuntimeEnvironment } from "@/lib/env";
import { initServerSentry } from "@/lib/observability/sentry/server";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { prisma } from "@/lib/db";
import { getQueues, closeQueues } from "@/lib/queue/client";
import { metricsAuthorized } from "@/lib/observability/metrics/auth";
import { renderProcessMetrics } from "@/lib/observability/metrics/render";

/** Token-protected Prometheus metrics for this process. Anything unauthorised is a bodyless 404. */
async function serveMetrics(authorization: string | undefined, response: import("node:http").ServerResponse) {
  try {
    if (!(await metricsAuthorized(authorization ?? null))) { response.writeHead(404).end(); return; }
    const { body, contentType } = await renderProcessMetrics();
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": contentType }).end(body);
  } catch { response.writeHead(404).end(); }
}

export async function runProcess(role: "worker" | "beat", start: () => Promise<{ stop: () => Promise<unknown>; healthy: () => Promise<boolean> }>) {
  validateRuntimeEnvironment();
  await initServerSentry(role); // best effort; never blocks startup
  const queues = getQueues(true);
  const client = await queues.scheduled.client;
  const key = `sww:jobs:heartbeat:${role}:${hostname()}:${process.pid}`;
  let stopping = false;
  let lastSuccess = 0;
  const processState = await start();
  let pulsing = false;
  const pulse = async () => {
    if (pulsing || stopping) return;
    pulsing = true;
    try {
      if (!(await processState.healthy())) { lastSuccess = 0; return; }
      await client.set(key, String(Date.now()), { EX: 45 });
      lastSuccess = Date.now();
    } catch { console.error(`[queue] ${role} heartbeat failed`); }
    finally { pulsing = false; }
  };
  await pulse();
  const timer = setInterval(() => void pulse(), 10_000);
  const server = createServer((request, response) => {
    if (request.url === "/metrics") { void serveMetrics(request.headers.authorization, response); return; }
    if (request.url !== "/health") { response.writeHead(404).end(); return; }
    const healthy = !stopping && Date.now() - lastSuccess < 30_000;
    response.writeHead(healthy ? 200 : 503, { "Cache-Control": "no-store", "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: healthy, role }));
  });
  const port = Number(process.env.JOBS_HEALTH_PORT || 3460);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid jobs health port.");
  server.listen(port, process.env.SPACEWORKS_LOCAL_STACK === "1" ? "127.0.0.1" : "0.0.0.0");
  server.on("error", () => { console.error("[queue] health server failed"); void shutdown().then(() => process.exit(1), () => process.exit(1)); });
  let shutdownPromise: Promise<void> | undefined;
  function shutdown(): Promise<void> {
    return shutdownPromise ??= (async () => {
      stopping = true;
      clearInterval(timer);
      server.close();
      try { await processState.stop(); }
      finally {
        await client.del(key).catch(() => undefined);
        await closeQueues(queues);
        await prisma.$disconnect();
        console.info(`[queue] ${role} stopped`);
      }
    })();
  }
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { void shutdown().then(() => process.exit(0), () => process.exit(1)); });
  // The local supervisor can drain Node workers on Windows through IPC too.
  if (process.env.SPACEWORKS_LOCAL_STACK === "1") process.on("message", (message: unknown) => {
    if (message && typeof message === "object" && "type" in message && message.type === "spaceworks.local.shutdown") {
      void shutdown().then(() => process.exit(0), () => process.exit(1));
    }
  });
}

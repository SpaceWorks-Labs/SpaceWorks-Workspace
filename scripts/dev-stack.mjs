// Cross-platform local supervisor. Service provisioning remains in local.sh/Compose.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function port(value, fallback) {
  const number = Number(value || fallback);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error("Local service ports must be integers between 1 and 65535.");
  return number;
}

const loopback = (host) => ["localhost", "127.0.0.1", "::1"].includes(host.replace(/^\[|\]$/g, "").toLowerCase());

/**
 * Local tooling must never migrate or process jobs against a remote install.
 * @param {Record<string, string | undefined>} env
 */
export function assertLocalServices(env = process.env) {
  for (const [name, protocols] of [
    ["DATABASE_URL", ["postgresql:", "postgres:"]], ["DIRECT_URL", ["postgresql:", "postgres:"]],
    ["REDIS_URL", ["redis:", "rediss:"]], ["S3_ENDPOINT", ["http:", "https:"]],
  ]) {
    const value = env[name];
    if (!value && ["DIRECT_URL", "S3_ENDPOINT"].includes(name)) continue;
    let url;
    try { url = new URL(value); } catch { throw new Error(`${name} must name a local service before starting dev:stack.`); }
    if (!protocols.includes(url.protocol) || !loopback(url.hostname)) throw new Error(`${name} must use a loopback host for the local stack. Remote services were not changed.`);
  }
  if (env.S3_BUCKET && !env.S3_ENDPOINT) throw new Error("Set S3_ENDPOINT to local Silo for the local stack.");
  if (env.SMTP_SERVICE || (env.SMTP_HOST && !loopback(env.SMTP_HOST))) throw new Error("Use local Mailpit SMTP_HOST for the local stack; remote email was not contacted.");
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Array<{name: string, args: string[], env: Record<string, string | undefined>, ipc?: boolean}>}
 */
export function localServices(env = process.env) {
  if (env.NODE_ENV === "production") throw new Error("dev:stack is for local development only.");
  assertLocalServices(env);
  const ports = [port(env.PORT, 3000), port(env.SWW_DEV_WORKER_PORT, 3460), port(env.SWW_DEV_BEAT_PORT, 3461)];
  if (new Set(ports).size !== ports.length) throw new Error("Web, worker and beat must use different local ports.");
  const common = { ...env, NODE_ENV: "development", JOBS_INPROCESS: "false", SPACEWORKS_LOCAL_STACK: "1" };
  return [
    { name: "web", args: ["node_modules/next/dist/bin/next", "dev", "--port", String(ports[0])], env: common },
    { name: "worker", args: ["dist/worker.js"], env: { ...common, JOBS_HEALTH_PORT: String(ports[1]) }, ipc: true },
    { name: "beat", args: ["dist/beat.js"], env: { ...common, JOBS_HEALTH_PORT: String(ports[2]) }, ipc: true },
  ];
}

function forceStop(child) {
  if (process.platform === "win32" && child.pid) {
    // Next spawns its own server child. Stop only this supervisor's process tree.
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.on("error", () => child.kill("SIGKILL"));
  } else child.kill("SIGKILL");
}

/** Any unexpected child exit fails the stack; signals drain workers before exit. */
export function supervise(services, { spawnProcess = spawn, signals = process, graceMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    const children = new Set();
    let stopping = false;
    let result = 0;
    let timer;
    const finish = () => {
      if (!stopping || children.size) return;
      clearTimeout(timer);
      signals.removeListener("SIGINT", interrupt);
      signals.removeListener("SIGTERM", terminate);
      resolve(result);
    };
    const stop = (code) => {
      if (stopping) return;
      stopping = true;
      result = code;
      timer = setTimeout(() => {
        for (const child of children) forceStop(child);
      }, graceMs);
      for (const child of children) {
        if (child.connected) child.send({ type: "spaceworks.local.shutdown" }, (error) => { if (error) child.kill("SIGTERM"); });
        else if (process.platform === "win32") forceStop(child);
        else child.kill("SIGTERM");
      }
      finish();
    };
    const interrupt = () => stop(130);
    const terminate = () => stop(143);
    signals.once("SIGINT", interrupt);
    signals.once("SIGTERM", terminate);
    for (const service of services) {
      if (stopping) break;
      let child;
      try {
        child = spawnProcess(process.execPath, service.args, {
          env: service.env, stdio: service.ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit", windowsHide: true,
        });
      } catch {
        console.error(`[dev:stack] ${service.name} could not start.`);
        stop(1);
        break;
      }
      children.add(child);
      child.once("error", () => {
        children.delete(child);
        console.error(`[dev:stack] ${service.name} could not start.`);
        stop(1);
        finish();
      });
      child.once("exit", (code) => {
        children.delete(child);
        if (!stopping) {
          console.error(`[dev:stack] ${service.name} exited. Stopping local services.`);
          stop(typeof code === "number" && code !== 0 ? code : 1);
        }
        finish();
      });
    }
    if (!services.length) stop(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const services = localServices();
    if (!existsSync("dist/worker.js") || !existsSync("dist/beat.js")) throw new Error("Build the background jobs first with npm run build:jobs.");
    console.info("[dev:stack] Starting web, BullMQ worker and beat. Local mail: http://127.0.0.1:8025");
    process.exitCode = await supervise(services);
  } catch (error) {
    console.error(`[dev:stack] ${error instanceof Error ? error.message : "Startup failed."}`);
    process.exitCode = 1;
  }
}

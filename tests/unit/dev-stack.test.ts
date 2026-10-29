import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { assertLocalServices, localServices, supervise } from "@/scripts/dev-stack.mjs";

const local = { DATABASE_URL: "postgresql://local:local@127.0.0.1:5440/local_test", REDIS_URL: "redis://127.0.0.1:6395" };

class Child extends EventEmitter {
  connected = true;
  kill = vi.fn(() => { queueMicrotask(() => this.emit("exit", 0)); return true; });
  send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
    callback(null);
    this.kill();
  });
}

function harness() {
  const children: Child[] = [];
  const signals = new EventEmitter();
  const spawnProcess = vi.fn(() => { const child = new Child(); children.push(child); return child; });
  const done = supervise(localServices(local), {
    spawnProcess: spawnProcess as unknown as typeof spawn,
    signals: signals as typeof process,
  });
  return { children, signals, spawnProcess, done };
}

describe("complete local development stack", () => {
  it("starts web, worker and beat with separate health ports and no in-process job poller", () => {
    const services = localServices({ ...local, PORT: "3100" });
    expect(services.map((service) => service.name)).toEqual(["web", "worker", "beat"]);
    expect(services[0].args).toContain("3100");
    expect(services[1].env.JOBS_HEALTH_PORT).toBe("3460");
    expect(services[2].env.JOBS_HEALTH_PORT).toBe("3461");
    expect(services.every((service) => service.env.JOBS_INPROCESS === "false")).toBe(true);
    expect(services.slice(1).every((service) => service.ipc)).toBe(true);
  });

  it("rejects missing Redis, conflicting ports and production use", () => {
    expect(() => localServices({ DATABASE_URL: local.DATABASE_URL })).toThrow("REDIS_URL");
    expect(() => localServices({ ...local, REDIS_URL: "memory://" })).toThrow("REDIS_URL");
    expect(() => localServices({ ...local, SWW_DEV_BEAT_PORT: "3460" })).toThrow("different");
    expect(() => localServices({ ...local, NODE_ENV: "production" })).toThrow("local development");
  });

  it.each([
    { DATABASE_URL: "postgresql://db.example.test/prod" },
    { DIRECT_URL: "postgresql://db.example.test/prod" },
    { REDIS_URL: "redis://redis.example.test" },
    { S3_ENDPOINT: "https://bucket.example.test" },
    { S3_BUCKET: "production" },
    { SMTP_HOST: "smtp.example.test" },
    { SMTP_SERVICE: "gmail" },
  ])("refuses a remote service before local startup: %j", (override) => {
    expect(() => assertLocalServices({ ...local, ...override })).toThrow();
  });

  it("drains all children on a termination signal and removes signal listeners", async () => {
    const { children, signals, done } = harness();
    signals.emit("SIGTERM");
    expect(await done).toBe(143);
    expect(children.every((child) => child.send.mock.calls[0][0] && child.kill.mock.calls.length === 1)).toBe(true);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });

  it("stops siblings and fails the stack if one child exits unexpectedly", async () => {
    const { children, done } = harness();
    children[0].emit("exit", 7);
    expect(await done).toBe(7);
    expect(children[1].send).toHaveBeenCalledWith({ type: "spaceworks.local.shutdown" }, expect.any(Function));
    expect(children[2].send).toHaveBeenCalledOnce();
  });
});

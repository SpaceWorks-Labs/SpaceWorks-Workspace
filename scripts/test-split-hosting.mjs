// Disposable split-hosting verification with explicit generated configuration.
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { rm } from "node:fs/promises";

const system = Object.fromEntries(["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TERM", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
const frontendKeys = ["NEXT_PUBLIC_BASE_URL", "BACKEND_ORIGIN", "NEXT_PUBLIC_BACKEND_ORIGIN", "FRONTEND_GATEWAY_SECRET", "FRONTEND_TRUSTED_IP_HEADER", "CI", "ALLOW_INSECURE_PRODUCTION_TESTS", "NEXT_TELEMETRY_DISABLED", "__NEXT_PROCESSED_ENV", "SWW_DISABLE_BUILD_CACHE", "NODE_OPTIONS"];
function frontendEnvironment(source) {
  return { ...system, ...Object.fromEntries(frontendKeys.map((key) => [key, source[key]])), NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: source.FRONTEND_ACTIONS_KEY, NODE_ENV: "production" };
}
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}).`)));
  });
}
if (process.argv[2] === "serve-frontend") {
  await run("npm", ["run", "start", "--workspace=frontend"], frontendEnvironment(process.env));
} else {
  const monolith = process.argv.includes("--monolith");
  const demo = process.argv.includes("--demo");
  // Explicit opt-in for pre-provisioned, disposable local test services.
  const externalServices = process.argv.includes("--external-services");
  if (externalServices && (!process.env.DATABASE_URL || !process.env.REDIS_URL)) {
    throw new Error("External test services require DATABASE_URL and REDIS_URL.");
  }
  const freePort = () => new Promise((resolve, reject) => {
    const server = createServer(); server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
  const [pgPort, redisPort] = await Promise.all([freePort(), freePort()]);
  const suffix = randomBytes(6).toString("hex");
  const pg = `sww-split-pg-${suffix}`, redis = `sww-split-redis-${suffix}`;
  const hex = () => randomBytes(32).toString("hex"), key = () => randomBytes(32).toString("base64");
  const password = hex();
  const demoPassword = demo ? hex() : "";
  const storageKeys = ["S3_BUCKET", "S3_REGION", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_FORCE_PATH_STYLE"];
  const storage = externalServices ? Object.fromEntries(storageKeys.filter(name => process.env[name]).map(name => [name, process.env[name]])) : {};
  const env = { ...system, NODE_OPTIONS: "--max-old-space-size=4096", SWW_DISABLE_BUILD_CACHE: "1", __NEXT_PROCESSED_ENV: "true", CI: "true", ALLOW_INSECURE_PRODUCTION_TESTS: "1", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: externalServices ? process.env.DATABASE_URL : `postgresql://sww_split:${password}@127.0.0.1:${pgPort}/sww_split_test`,
    DIRECT_URL: externalServices ? (process.env.DIRECT_URL || process.env.DATABASE_URL) : `postgresql://sww_split:${password}@127.0.0.1:${pgPort}/sww_split_test`,
    REDIS_URL: externalServices ? process.env.REDIS_URL : `redis://127.0.0.1:${redisPort}`, POSTGRES_PASSWORD: password,
    AUTH_URL: "http://127.0.0.1:3100", NEXT_PUBLIC_BASE_URL: "http://127.0.0.1:3100",
    BACKEND_ORIGIN: "http://127.0.0.1:3200", NEXT_PUBLIC_BACKEND_ORIGIN: monolith ? "" : "http://127.0.0.1:3200",
    AUTH_SECRET: hex(), MFA_ENCRYPTION_KEY: key(), INTEGRATION_ENCRYPTION_KEY: key(), VAULT_MASTER_KEY: key(), NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: key(), FRONTEND_ACTIONS_KEY: key(), FRONTEND_GATEWAY_SECRET: hex(),
    HEALTHCHECK_SECRET: hex(), CRON_SECRET: hex(), SUPER_ADMIN_EMAIL: "admin@example.test",
    TRUSTED_PROXY_IP_HEADER: "x-real-ip", FRONTEND_TRUSTED_IP_HEADER: "x-real-ip",
    EMAIL_FROM: "Test <test@example.test>", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", SMTP_USER: "disposable", SMTP_PASSWORD: hex(),
    S3_BUCKET: "disposable-test", S3_REGION: "us-east-1", ...storage,
    // Explicitly seed only this disposable database when demo journeys are requested.
    DEMO_PASSWORD: demoPassword, PLATFORM_SHELL_E2E_PASSWORD: demoPassword,
    PLAYWRIGHT_SPLIT: monolith ? "0" : "1", PLAYWRIGHT_PORT: "3100", PLAYWRIGHT_TRUSTED_IP_HEADER: "x-real-ip",
    PLAYWRIGHT_SERVER_COMMAND: monolith ? "PORT=3100 HOSTNAME=127.0.0.1 node .next/standalone/server.js" : "node scripts/test-split-hosting.mjs serve-frontend",
  };
  let backend;
  const cleanup = () => {
    backend?.kill("SIGTERM");
    if (!externalServices) for (const name of [pg, redis]) spawnSync("docker", ["rm", "--force", "--volumes", name], { stdio: "ignore", env: system, timeout: 15_000 });
  };
  try {
    // Fail before making containers if either application's fixed test port is busy.
    for (const port of [3100, 3200]) await new Promise((resolve, reject) => { const server = createServer(); server.on("error", () => reject(new Error(`Test port ${port} is already in use.`))); server.listen(port, "127.0.0.1", () => server.close(resolve)); });
    if (!externalServices) {
      await run("docker", ["run", "-d", "--name", pg, "-e", "POSTGRES_USER=sww_split", "-e", "POSTGRES_DB=sww_split_test", "-e", "POSTGRES_PASSWORD", "-p", `127.0.0.1:${pgPort}:5432`, "postgres:16-alpine"], env);
      await run("docker", ["run", "-d", "--name", redis, "-p", `127.0.0.1:${redisPort}:6379`, "redis:7-alpine"], env);
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (spawnSync("docker", ["exec", pg, "pg_isready", "-U", "sww_split", "-d", "sww_split_test"], { stdio: "ignore", env: system }).status === 0) { ready = true; break; }
        await delay(500);
      }
      if (!ready) throw new Error("Disposable PostgreSQL did not become ready.");
    }
    await run(process.execPath, ["scripts/prisma.mjs", "migrate", "deploy"], env);
    if (demo) await run(process.execPath, ["scripts/seed-demo.mjs"], { ...env, NODE_ENV: "development", ...(storage.S3_BUCKET ? {} : { S3_BUCKET: "", S3_REGION: "" }) });
    await run("npm", ["run", "build"], env);
    await run(process.execPath, ["scripts/prepare-standalone.mjs"], env);
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development"]) await rm(`.next/standalone/${name}`, { force: true });
    if (!monolith) {
      await run("npm", ["run", "build:frontend"], frontendEnvironment(env));
      backend = spawn(process.execPath, [".next/standalone/server.js"], { env: { ...env, DEPLOYMENT_MODE: "backend", PORT: "3200", HOSTNAME: "127.0.0.1" }, stdio: "inherit" });
      backend.on("error", () => {});
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { const response = await fetch("http://127.0.0.1:3200/api/health", { signal: AbortSignal.timeout(1000) }); await response.body?.cancel(); if (response.ok) { ready = true; break; } } catch { /* startup */ }
        await delay(200);
      }
      if (!ready) throw new Error("Disposable backend did not become ready.");
    }
    await run("npx", ["playwright", "test", "--workers=1"], { ...env, ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}) });
    if (monolith) console.log("Whole-VPS production browser suite passed against disposable dependencies.");
    else console.log("Split hosting passed with separate action keys and no database/auth/mail/storage credentials on the frontend.");
  } finally { cleanup(); }
}

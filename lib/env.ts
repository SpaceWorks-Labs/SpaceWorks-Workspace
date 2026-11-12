import "server-only";

import { z } from "zod";

const secret = z.string().min(32, "must be at least 32 characters");
const optionalString = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

function isBase64Key(value: string, lengths: number[]) {
  try {
    const normalized = value.replace(/=+$/, "");
    const decoded = Buffer.from(value, "base64");
    return lengths.includes(decoded.length) && decoded.toString("base64").replace(/=+$/, "") === normalized;
  } catch {
    return false;
  }
}

const serverActionsKey = z.string().refine((value) => isBase64Key(value, [16, 24, 32]), {
  message: "must be valid base64 that decodes to a 16, 24, or 32 byte AES key",
});

const aes256Key = z.string().refine((value) => isBase64Key(value, [32]), {
  message: "must be valid base64 that decodes to a 32 byte AES key",
});

export const envSchema = z.object({
  DEPLOYMENT_MODE: optionalString(z.enum(["backend"])),
  FRONTEND_GATEWAY_SECRET: optionalString(z.string().regex(/^[a-f0-9]{64}$/, "must contain 32 random bytes encoded as hex")),
  BACKEND_ORIGIN: optionalString(z.string().url()),
  NEXT_PUBLIC_BACKEND_ORIGIN: optionalString(z.string().url()),
  DATABASE_URL: z.string().url("must be a valid database connection URL"),
  DIRECT_URL: optionalString(z.string().url("must be a valid database connection URL")),
  AUTH_SECRET: secret,
  AUTH_URL: optionalString(z.string().url("must be a valid URL")),
  AUTH_GOOGLE_ID: optionalString(z.string().min(1)),
  AUTH_GOOGLE_SECRET: optionalString(z.string().min(1)),
  NEXT_PUBLIC_BASE_URL: optionalString(z.string().url()),
  EMAIL_FROM: optionalString(z.string().min(3)),
  SMTP_HOST: optionalString(z.string().min(1)),
  SMTP_PORT: optionalString(z.coerce.number().int().min(1).max(65535)),
  SMTP_SECURE: optionalString(z.enum(["true", "false"])),
  SMTP_SERVICE: optionalString(z.string().min(1)),
  SMTP_USER: optionalString(z.string().min(1)),
  SMTP_PASSWORD: optionalString(z.string().min(1)),
  SMTP_ALLOW_UNAUTHENTICATED: optionalString(z.enum(["0", "1"])),
  REDIS_URL: optionalString(z.string().url()),
  CRON_SECRET: optionalString(secret),
  HEALTHCHECK_SECRET: optionalString(secret),
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: optionalString(serverActionsKey),
  MFA_ENCRYPTION_KEY: optionalString(aes256Key),
  INTEGRATION_ENCRYPTION_KEY: optionalString(aes256Key),
  VAULT_MASTER_KEY: optionalString(aes256Key),
  VAULT_MASTER_KEYS: optionalString(z.string().refine(value => {
    const entries = value.split(","); const versions = new Set<string>();
    return entries.length > 0 && entries.every(entry => { const [version, key, extra] = entry.split(":"); if (!/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version)) || extra || versions.has(version) || !isBase64Key(key ?? "", [32])) return false; versions.add(version); return true; });
  }, "must contain unique version:base64 key entries")),
  S3_BUCKET: optionalString(z.string().min(1)),
  S3_REGION: optionalString(z.string().min(1)),
  S3_ENDPOINT: optionalString(z.string().url()),
  S3_ACCESS_KEY_ID: optionalString(z.string().min(1)),
  S3_SECRET_ACCESS_KEY: optionalString(z.string().min(1)),
  S3_FORCE_PATH_STYLE: optionalString(z.enum(["0", "1"])),
  UPLOAD_MAX_BYTES: optionalString(z.coerce.number().int().positive().max(500 * 1024 * 1024)),
  ANTHROPIC_API_KEY: optionalString(z.string().min(1)),
  ASSISTANT_MODEL: optionalString(z.string().min(1)),
  SEARXNG_URL: optionalString(z.string().url()),
  GOOGLE_CLIENT_ID: optionalString(z.string().min(1)),
  GOOGLE_CLIENT_SECRET: optionalString(z.string().min(1)),
  GITHUB_APP_ID: optionalString(z.string().min(1)),
  GITHUB_APP_NAME: optionalString(z.string().min(1)),
  GITHUB_APP_PRIVATE_KEY: optionalString(z.string().min(1)),
  GITHUB_APP_PRIVATE_KEY_FILE: optionalString(z.string().min(1)),
  GITHUB_WEBHOOK_SECRET: optionalString(z.string().min(16)),
  TELEGRAM_BOT_TOKEN: optionalString(z.string().min(1)),
  TELEGRAM_WEBHOOK_SECRET: optionalString(z.string().min(16)),
  ALLOW_INSECURE_PRODUCTION_TESTS: optionalString(z.enum(["0", "1"])),
  ALLOWED_ACTION_ORIGINS: optionalString(z.string()),
  TRUSTED_PROXY_IP_HEADER: optionalString(z.enum(["cf-connecting-ip", "x-forwarded-for", "x-real-ip"])),
  TRUSTED_PROXY_HOPS: optionalString(z.string().regex(/^[1-9]\d?$/, "must be a positive whole number")),
  SUPER_ADMIN_EMAIL: optionalString(z.string().email()),
  OUTBOX_RETENTION_DAYS: optionalString(z.coerce.number().int().positive().max(365)),
  // Messaging, notification routing and the Services monitor.
  ALLOW_PRIVATE_WEBHOOK_TARGETS: optionalString(z.enum(["true", "false"])),
  NOTIFY_WORKER_CONCURRENCY: optionalString(z.coerce.number().int().min(1).max(100)),
  JOBS_INPROCESS: optionalString(z.enum(["true", "false"])),
  JOBS_HEALTH_PORT: optionalString(z.coerce.number().int().min(1).max(65535)),
  JOBS_QUEUE_PREFIX: optionalString(z.string().regex(/^[a-zA-Z0-9:_-]{1,100}$/)),
  QUEUE_OUTBOX_CONCURRENCY: optionalString(z.coerce.number().int().min(1).max(64)),
  QUEUE_SCHEDULED_CONCURRENCY: optionalString(z.coerce.number().int().min(1).max(64)),
  QUEUE_SYNC_CONCURRENCY: optionalString(z.coerce.number().int().min(1).max(64)),
  QUEUE_MONITOR_CONCURRENCY: optionalString(z.coerce.number().int().min(1).max(64)),
  QUEUE_DOCUMENTS_CONCURRENCY: optionalString(z.coerce.number().int().min(1).max(64)),
  MONITOR_ALLOW_PRIVATE_TARGETS: optionalString(z.enum(["true", "false"])),
  MONITOR_MAX_PER_WORKSPACE: optionalString(z.coerce.number().int().min(1).max(10_000)),
  // Sign-in providers, observability and instance defaults (all optional, all off by default).
  AUTH_GITHUB_ID: optionalString(z.string().min(1)),
  AUTH_GITHUB_SECRET: optionalString(z.string().min(1)),
  AUTH_APPLE_ID: optionalString(z.string().min(1)),
  AUTH_APPLE_TEAM_ID: optionalString(z.string().min(1)),
  AUTH_APPLE_KEY_ID: optionalString(z.string().min(1)),
  AUTH_APPLE_PRIVATE_KEY: optionalString(z.string().min(1)),
  SENTRY_DSN: optionalString(z.string().url()),
  SENTRY_ENVIRONMENT: optionalString(z.string().min(1)),
  SENTRY_TRACES_SAMPLE_RATE: optionalString(z.coerce.number().min(0).max(1)),
  POSTHOG_KEY: optionalString(z.string().min(1)),
  POSTHOG_HOST: optionalString(z.string().url()),
  CLARITY_PROJECT_ID: optionalString(z.string().regex(/^[a-z0-9]{4,32}$/i, "must be a Clarity project id")),
  METRICS_TOKEN: optionalString(secret),
  METABASE_SECRET_KEY: optionalString(z.string().min(16)),
  OBS_CSP_PROVIDERS: optionalString(z.string()),
  OBS_CSP_CONNECT_ORIGINS: optionalString(z.string()),
  OBS_CSP_FRAME_ORIGINS: optionalString(z.string()),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Variables a production server refuses to start without. */
export const REQUIRED_IN_PRODUCTION = [
  "AUTH_URL",
  "NEXT_PUBLIC_BASE_URL",
  "REDIS_URL",
  "CRON_SECRET",
  "HEALTHCHECK_SECRET",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
  "MFA_ENCRYPTION_KEY",
  "TRUSTED_PROXY_IP_HEADER",
  "S3_BUCKET",
  "S3_REGION",
] as const;

// Display-only parse for server-rendered operations pages; never throws on import.
export const env = envSchema.safeParse(process.env).data;

function issueMessages(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`);
}

/**
 * Returns human-readable problems with a production environment (empty when
 * valid). Pure: takes the environment as an argument so it can be tested.
 */
export function productionEnvironmentProblems(source: Record<string, string | undefined>): string[] {
  const parsed = envSchema.safeParse(source);
  const problems = parsed.success ? [] : issueMessages(parsed.error);
  for (const key of REQUIRED_IN_PRODUCTION) {
    if (!source[key]?.trim()) problems.push(`${key}: required in production`);
  }
  if (source.JOBS_INPROCESS === "true") problems.push("JOBS_INPROCESS is local development only; run worker and beat in production.");
  if (source.DEPLOYMENT_MODE === "backend" && !source.FRONTEND_GATEWAY_SECRET) problems.push("FRONTEND_GATEWAY_SECRET: required for the backend deployment mode");
  if (Boolean(source.S3_ACCESS_KEY_ID) !== Boolean(source.S3_SECRET_ACCESS_KEY)) {
    problems.push("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY: set both, or neither when using an IAM role");
  }
  if (problems.length > 0) return problems;

  const insecureCiTest = source.CI === "true" && source.ALLOW_INSECURE_PRODUCTION_TESTS === "1";
  const baseUrl = new URL(source.NEXT_PUBLIC_BASE_URL!);
  const authUrl = new URL(source.AUTH_URL!);
  if ((!insecureCiTest && (baseUrl.protocol !== "https:" || authUrl.protocol !== "https:")) || baseUrl.origin !== authUrl.origin) {
    problems.push("AUTH_URL and NEXT_PUBLIC_BASE_URL must be the same HTTPS origin in production.");
  }
  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const value = source[key];
    if (!value) continue;
    const databaseUrl = new URL(value);
    if (!insecureCiTest && !["require", "verify-ca", "verify-full"].includes(databaseUrl.searchParams.get("sslmode") ?? "")) {
      problems.push(`${key} must require TLS using sslmode=require, verify-ca, or verify-full.`);
    }
  }
  const runtimeDatabaseUrl = new URL(source.DATABASE_URL!);
  if (runtimeDatabaseUrl.port === "6543" && runtimeDatabaseUrl.searchParams.get("pgbouncer") !== "true") {
    problems.push("DATABASE_URL uses a transaction pooler port (6543): add pgbouncer=true.");
  }
  if (!insecureCiTest && new URL(source.REDIS_URL!).protocol !== "rediss:") {
    problems.push("REDIS_URL must use TLS (rediss://) in production.");
  }
  if (!insecureCiTest && source.S3_ENDPOINT && new URL(source.S3_ENDPOINT).protocol !== "https:") {
    problems.push("S3_ENDPOINT must use HTTPS in production.");
  }
  return problems;
}

/** Validate only when a production server starts, never as an import side effect. */
export function validateRuntimeEnvironment() {
  if (process.env.NODE_ENV !== "production") return;
  const problems = productionEnvironmentProblems(process.env);
  if (problems.length > 0) {
    throw new Error(`Invalid production environment configuration: ${problems.join("; ")}`);
  }
}

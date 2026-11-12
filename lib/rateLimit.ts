import { isIP } from "node:net";
import { isFrontendPeer, CLIENT_IP_HEADER } from "@/lib/frontend/peer";
import type { NextRequest } from "next/server";
import Redis from "ioredis";

/**
 * Fixed-window rate limits in Redis (shared across replicas). Without Redis,
 * development falls back to process memory; production fails closed.
 */

export type Bucket =
  | "global"
  | "frontendAction"
  | "action"
  | "bulk"
  | "auth"
  | "setup"
  | "passwordReset"
  | "invite"
  | "inviteAccept"
  | "upload"
  | "search"
  | "message"
  | "assistant"
  | "apiRead"
  | "apiWrite"
  | "webhook"
  | "dataExport"
  | "realtime"
  | "subscribe"
  | "emailSignup"
  | "emailResend"
  | "emailConfirm"
  | "orgRequest"
  | "paymentWebhook"
  | "paymentRefund"
  | "campaignPublic"
  | "campaignTestSend"
  | "campaignConfirmEmail"
  | "campaignConfirmWorkspace";

const limits: Record<Bucket, { max: number; windowMs: number; }> = {
  global: { max: 600, windowMs: 60_000 },
  frontendAction: { max: 240, windowMs: 60_000 },
  action: { max: 240, windowMs: 60_000 },
  // Bulk edits spend one unit per task (lib/tasks/bulkSchemas MAX_BULK = 50 per call).
  bulk: { max: 200, windowMs: 60_000 },
  auth: { max: 10, windowMs: 60_000 },
  setup: { max: 5, windowMs: 60 * 60_000 },
  passwordReset: { max: 5, windowMs: 60 * 60_000 },
  invite: { max: 30, windowMs: 60 * 60_000 },
  inviteAccept: { max: 10, windowMs: 60 * 60_000 },
  upload: { max: 60, windowMs: 60 * 60_000 },
  search: { max: 60, windowMs: 60_000 },
  message: { max: 60, windowMs: 60_000 },
  assistant: { max: 30, windowMs: 60_000 },
  apiRead: { max: 600, windowMs: 60_000 },
  apiWrite: { max: 60, windowMs: 60_000 },
  webhook: { max: 600, windowMs: 60_000 },
  dataExport: { max: 5, windowMs: 60 * 60_000 },
  // SSE connections (one per open tab, reconnects after network blips).
  realtime: { max: 60, windowMs: 60_000 },
  subscribe: { max: 5, windowMs: 60 * 60_000 },
  emailSignup: { max: 5, windowMs: 60 * 60_000 },
  emailResend: { max: 5, windowMs: 60 * 60_000 },
  emailConfirm: { max: 10, windowMs: 60 * 60_000 },
  // One refund request per payment per minute, so a double click cannot refund twice before the webhook lands.
  paymentRefund: { max: 1, windowMs: 60_000 },
  orgRequest: { max: 10, windowMs: 24 * 60 * 60_000 },
  paymentWebhook: { max: 600, windowMs: 60_000 },
  campaignPublic: { max: 120, windowMs: 60_000 },
  // Test sends per user per day; confirmation emails per address (all workspaces) and per workspace per day.
  campaignTestSend: { max: 20, windowMs: 24 * 60 * 60_000 },
  campaignConfirmEmail: { max: 3, windowMs: 24 * 60 * 60_000 },
  campaignConfirmWorkspace: { max: 500, windowMs: 24 * 60 * 60_000 },
};

// Local fallback store
type Entry = { count: number; resetAt: number; };
const memoryStore = new Map<string, Entry>();

let redisClient: Redis | null = null;
let isRedisDisabled = false;

function allowTestMemoryFallback() {
  return process.env.CI === "true" && process.env.ALLOW_INSECURE_PRODUCTION_TESTS === "1";
}

function getRedisClient(): Redis | null {
  if (isRedisDisabled) return null;
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl === "memory://" && allowTestMemoryFallback()) {
    isRedisDisabled = true;
    return null;
  }
  if (!redisUrl) {
    isRedisDisabled = true;
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      lazyConnect: true,
    });

    redisClient.on("error", () => {
      console.warn("[rateLimit] Redis client error");
    });

    return redisClient;
  } catch {
    console.error("[rateLimit] Redis client initialization failed");
    isRedisDisabled = true;
    return null;
  }
}

function keyFor(bucket: Bucket, id: string) {
  return `sww:ratelimit:${bucket}:${id}`;
}

export function getClientIp(request: NextRequest): string {
  if (isFrontendPeer(request.headers)) { const ip = request.headers.get(CLIENT_IP_HEADER)?.trim(); return ip && isIP(ip) ? ip : "unknown"; }
  const configuredHeader = process.env.TRUSTED_PROXY_IP_HEADER;
  if (isTrustedProxyHeader(configuredHeader)) return readConfiguredIp(request.headers, configuredHeader);
  return "unknown";
}

export function getClientIpFromHeaders(headers: Headers): string {
  if (isFrontendPeer(headers)) { const ip = headers.get(CLIENT_IP_HEADER)?.trim(); return ip && isIP(ip) ? ip : "unknown"; }
  const configuredHeader = process.env.TRUSTED_PROXY_IP_HEADER;
  return isTrustedProxyHeader(configuredHeader) ? readConfiguredIp(headers, configuredHeader) : "unknown";
}

function isTrustedProxyHeader(value: string | undefined): value is "cf-connecting-ip" | "x-forwarded-for" | "x-real-ip" {
  return value === "cf-connecting-ip" || value === "x-forwarded-for" || value === "x-real-ip";
}

function readConfiguredIp(headers: Headers, header: "cf-connecting-ip" | "x-forwarded-for" | "x-real-ip") {
  const value = headers.get(header)?.trim();
  if (!value) return "unknown";
  return header === "x-forwarded-for" ? forwardedClientIp(value) : value;
}

/**
 * The client address in `X-Forwarded-For`. By default the edge is expected to
 * overwrite the header, so the left-most entry is the client. Proxies that
 * append instead (Render) leave client-chosen values on the left; set
 * `TRUSTED_PROXY_HOPS` to the number of trusted proxies to read the entry the
 * outermost trusted proxy added, counted from the right.
 */
function forwardedClientIp(value: string): string {
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
  const entry = Number.isInteger(hops) && hops > 0 ? entries[Math.max(0, entries.length - hops)] : entries[0];
  return entry || "unknown";
}

function checkRateLimitMemory(bucket: Bucket, id: string, cost = 1): boolean {
  const k = keyFor(bucket, id);
  const { max, windowMs } = limits[bucket];
  const now = Date.now();
  let entry = memoryStore.get(k);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    memoryStore.set(k, entry);
  }
  entry.count += cost;
  return entry.count <= max;
}

/** Returns true if the request is allowed; false if rate limited. */
export async function checkRateLimit(
  request: NextRequest,
  bucket: Bucket,
): Promise<boolean> {
  return checkRateLimitById(bucket, getClientIp(request));
}

/** Check a bucket using a privacy-safe, caller-provided subject key. */
export async function checkRateLimitById(bucket: Bucket, id: string, cost = 1): Promise<boolean> {
  const redis = getRedisClient();

  if (!redis) {
    if (process.env.NODE_ENV === "production" && !allowTestMemoryFallback()) return false;
    return checkRateLimitMemory(bucket, id, cost);
  }

  const k = keyFor(bucket, id);
  const { max, windowMs } = limits[bucket];

  try {
    // Increment and expiry must be one Redis operation. A pipeline can leave
    // an unexpiring key behind if the process dies between INCR and PEXPIRE.
    const count = await redis.eval(
      "local c = redis.call('INCRBY', KEYS[1], ARGV[2]); if c == tonumber(ARGV[2]) then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return c",
      1,
      k,
      String(windowMs),
      String(cost),
    );
    return Number(count) <= max;
  } catch {
    console.warn("[rateLimit] Redis check failed");
    if (process.env.NODE_ENV === "production" && !allowTestMemoryFallback()) return false;
    return checkRateLimitMemory(bucket, id, cost);
  }
}

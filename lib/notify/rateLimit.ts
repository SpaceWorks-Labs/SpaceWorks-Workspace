import "server-only";

import { getRedis } from "@/lib/redis";

/**
 * Outbound per-destination token bucket. Capacity equals the per-minute limit
 * (one minute of burst) and refills continuously. Redis (atomic Lua) when
 * configured, otherwise an in-process map; a Redis error falls back to memory.
 */

/** Messages per minute by destination kind or personal channel. */
export const OUTBOUND_PER_MINUTE: Record<string, number> = {
  TELEGRAM: 20,
  TELEGRAM_DM: 20,
  WHATSAPP: 30,
  WHATSAPP_DM: 30,
  DISCORD: 25,
  DISCORD_DM: 25,
  SLACK: 50,
  SLACK_DM: 50,
  MATTERMOST: 60,
  MATTERMOST_DM: 60,
  WEBHOOK: 60,
  EMAIL: 120,
};
const DEFAULT_PER_MINUTE = 60;

export type BucketState = { tokens: number; at: number };

/** Pure bucket step: refill since `state.at`, then try to take one token. */
export function takeFromBucket(state: BucketState | undefined, nowMs: number, perMinute: number): { allowed: boolean; waitMs: number; state: BucketState } {
  const refillPerMs = perMinute / 60_000;
  const tokens = Math.min(perMinute, (state?.tokens ?? perMinute) + Math.max(0, nowMs - (state?.at ?? nowMs)) * refillPerMs);
  if (tokens >= 1) return { allowed: true, waitMs: 0, state: { tokens: tokens - 1, at: nowMs } };
  return { allowed: false, waitMs: Math.ceil((1 - tokens) / refillPerMs), state: { tokens, at: nowMs } };
}

const MEMORY_KEY = Symbol.for("sww.notifyBuckets");
type GlobalWithBuckets = typeof globalThis & { [MEMORY_KEY]?: Map<string, BucketState> };
const memory = () => ((globalThis as GlobalWithBuckets)[MEMORY_KEY] ??= new Map());

const LUA = `
local t = redis.call('HMGET', KEYS[1], 'tokens', 'at')
local cap = tonumber(ARGV[1]); local now = tonumber(ARGV[2]); local rate = cap / 60000
local tokens = tonumber(t[1]); local at = tonumber(t[2])
if not tokens then tokens = cap; at = now end
tokens = math.min(cap, tokens + math.max(0, now - at) * rate)
local allowed = 0; local wait = 0
if tokens >= 1 then tokens = tokens - 1; allowed = 1 else wait = math.ceil((1 - tokens) / rate) end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'at', tostring(now))
redis.call('PEXPIRE', KEYS[1], 120000)
return {allowed, wait}`;

/** Take one token for `key`. When refused, `waitMs` is how long until one is available. */
export async function consumeOutboundToken(key: string, perMinute: number, nowMs = Date.now()): Promise<{ allowed: boolean; waitMs: number }> {
  const redis = getRedis();
  if (redis) {
    try {
      const [allowed, wait] = (await redis.eval(LUA, 1, `sww:notify:bucket:${key}`, perMinute, nowMs)) as [number, number];
      return { allowed: allowed === 1, waitMs: wait };
    } catch {
      console.warn("[notify] Redis rate limit unavailable; using memory");
    }
  }
  const buckets = memory();
  const step = takeFromBucket(buckets.get(key), nowMs, perMinute);
  buckets.set(key, step.state);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (nowMs - v.at > 120_000) buckets.delete(k);
  return { allowed: step.allowed, waitMs: step.waitMs };
}

export function limitFor(kindOrChannel: string) {
  return OUTBOUND_PER_MINUTE[kindOrChannel] ?? DEFAULT_PER_MINUTE;
}

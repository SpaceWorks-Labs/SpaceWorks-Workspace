import "server-only";
import { getRedis } from "@/lib/redis";

/**
 * Per-workspace token bucket for campaign sends (capacity = sendPerMinute,
 * refilling continuously). Redis keeps it shared across workers; process
 * memory is the fallback when Redis is missing or erroring.
 */

const LUA = `
local cap=tonumber(ARGV[1]); local rate=tonumber(ARGV[2]); local now=tonumber(ARGV[3]); local want=tonumber(ARGV[4])
local d=redis.call('HMGET',KEYS[1],'t','ts'); local t=tonumber(d[1]); local ts=tonumber(d[2])
if not t then t=cap; ts=now end
t=math.min(cap, t+(now-ts)*rate)
local g=math.min(want, math.floor(t)); t=t-g
redis.call('HSET',KEYS[1],'t',t,'ts',now); redis.call('PEXPIRE',KEYS[1],120000)
return g`;

const MEMORY_KEY = Symbol.for("sww.campaigns.rate");
type Bucket = { tokens: number; at: number };
type G = typeof globalThis & { [MEMORY_KEY]?: Map<string, Bucket> };

function memory(): Map<string, Bucket> {
  return ((globalThis as G)[MEMORY_KEY] ??= new Map());
}

export function takeFromMemory(workspaceId: string, perMinute: number, want: number, now = Date.now()): number {
  const buckets = memory();
  const bucket = buckets.get(workspaceId) ?? { tokens: perMinute, at: now };
  const tokens = Math.min(perMinute, bucket.tokens + ((now - bucket.at) * perMinute) / 60_000);
  const granted = Math.min(want, Math.floor(tokens));
  buckets.set(workspaceId, { tokens: tokens - granted, at: now });
  return granted;
}

export function resetRateLimit(): void {
  memory().clear();
}

/** How many of `want` sends may go out now (0 to want). */
export async function takeSendTokens(workspaceId: string, perMinute: number, want: number): Promise<number> {
  const redis = getRedis();
  if (redis) {
    try {
      const granted = await redis.eval(LUA, 1, `campaigns:rate:${workspaceId}`, perMinute, perMinute / 60_000, Date.now(), want);
      return Number(granted);
    } catch {
      // Fall back to the in-process bucket.
    }
  }
  return takeFromMemory(workspaceId, perMinute, want);
}

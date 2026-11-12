import "server-only";

/**
 * Short per-process cache for the dashboard aggregates, so repeated visits
 * and range switches do not re-run instance-wide scans. Concurrent callers
 * share one in-flight load; a failed load is not cached.
 */
type Entry = { at: number; value?: unknown; inflight?: Promise<unknown> };
const KEY = Symbol.for("sww.adminDashboard.cache");
type GlobalWithCache = typeof globalThis & { [KEY]?: Map<string, Entry> };

function store(): Map<string, Entry> {
  const g = globalThis as GlobalWithCache;
  return (g[KEY] ??= new Map());
}

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const entries = store();
  const hit = entries.get(key);
  if (hit?.inflight) return hit.inflight as Promise<T>;
  if (hit && "value" in hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const inflight = load().then(
    (value) => { entries.set(key, { at: Date.now(), value }); return value; },
    (error: unknown) => { entries.delete(key); throw error; },
  );
  entries.set(key, { at: Date.now(), inflight });
  return inflight;
}

/** Test hook and manual refresh: forget every cached aggregate. */
export function resetDashboardCache(): void {
  store().clear();
}

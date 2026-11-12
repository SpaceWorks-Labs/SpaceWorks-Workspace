import "server-only";

import { instanceEmbed } from "@/lib/observability/metabase/embed";
import { cached } from "./cache";
import { parseRange, parseSort, windowFor } from "./compute";
import { loadSystemHealth } from "./health";
import { loadGrowth, loadKpis } from "./kpis";
import { loadOrgUsageRows, summariseOrgUsage } from "./orgUsage";
import { loadPlatforms } from "./platforms";
import { loadRecentActivity } from "./recent";
import { loadUsageTotals } from "./totals";
import type { AdminDashboardView, MetabaseEmbed } from "./types";

export type { AdminDashboardView } from "./types";

/** Instance-wide scans are cached briefly; health is near-live. */
const AGGREGATE_TTL_MS = 60_000;
const RECENT_TTL_MS = 20_000;
const HEALTH_TTL_MS = 10_000;

async function metabase(): Promise<MetabaseEmbed> {
  try {
    const embed = await instanceEmbed();
    return embed.embedUrl ? { embedUrl: embed.embedUrl, linkUrl: embed.linkUrl, reason: embed.reason ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * Everything `/admin` shows, as one plain view. The caller must already have
 * passed `requireSuperAdminMfa()`. Query input is parsed here, so unknown
 * values fall back to the defaults (30 days, ranked by members).
 */
export async function loadAdminDashboard(query: { range?: string | string[]; sort?: string | string[] }): Promise<AdminDashboardView> {
  const range = parseRange(query.range);
  const sort = parseSort(query.sort);
  const [aggregates, recent, health, platforms, embed] = await Promise.all([
    cached(`aggregates:${range}`, AGGREGATE_TTL_MS, async () => {
      const w = windowFor(range);
      const [kpis, growth, usage] = await Promise.all([loadKpis(w), loadGrowth(w), loadOrgUsageRows(w)]);
      const totals = await loadUsageTotals(w, usage.rows);
      return { generatedAt: w.until.toISOString(), kpis, growth, usage, totals };
    }),
    cached("recent", RECENT_TTL_MS, loadRecentActivity),
    cached("health", HEALTH_TTL_MS, () => loadSystemHealth()),
    cached("platforms", AGGREGATE_TTL_MS, loadPlatforms).catch(() => []),
    metabase(),
  ]);
  return {
    range,
    generatedAt: aggregates.generatedAt,
    kpis: aggregates.kpis,
    growth: aggregates.growth,
    usage: summariseOrgUsage(aggregates.usage, sort),
    totals: aggregates.totals,
    health,
    platforms,
    recent,
    metabase: embed,
  };
}

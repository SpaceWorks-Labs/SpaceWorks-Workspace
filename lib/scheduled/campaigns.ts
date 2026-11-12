import "server-only";
import { purgeOldEngagement } from "@/lib/campaigns/stats";
import { runCampaignSending } from "@/lib/campaigns/send/worker";

const PURGE_KEY = Symbol.for("sww.campaigns.purgedAt");
type G = typeof globalThis & { [PURGE_KEY]?: number };

/** Every 10 seconds: promote due campaigns and send. Engagement rows older than 13 months are purged hourly. */
export async function run(now: Date = new Date()): Promise<void> {
  await runCampaignSending(now);
  const g = globalThis as G;
  if (!g[PURGE_KEY] || Date.now() - g[PURGE_KEY]! > 3_600_000) {
    g[PURGE_KEY] = Date.now();
    await purgeOldEngagement(now);
  }
}

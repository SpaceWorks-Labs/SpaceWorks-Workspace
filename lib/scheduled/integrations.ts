import "server-only";
import { prisma } from "@/lib/db";
import { processInboundBatch } from "@/lib/messaging/processor";
import { bridgeOutbound } from "@/lib/messaging/bridging";
import { dispatchGithubEvents } from "@/lib/integrations/github/webhook";
import { sendRoutingReminders } from "@/lib/integrations/routing/reminders";
import { syncSeoSite } from "@/lib/seo/service";

export async function run(now: Date): Promise<void> {
  await processInboundBatch(now);
  await bridgeOutbound();
  await dispatchGithubEvents();
  await sendRoutingReminders(now);
  const cutoff = new Date(now.getTime() - 86400000);
  const sites = await prisma.seoSite.findMany({ where: { verified: true, connection: { provider: "GOOGLE", status: "ACTIVE" }, workspace: { status: "ACTIVE", archivedAt: null }, OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }] }, orderBy: { lastSyncedAt: "asc" }, take: 5 });
  for (const site of sites) {
    // Compare-and-set is a lease; failed syncs are eligible again after one day.
    const claimed = await prisma.seoSite.updateMany({ where: { id: site.id, workspaceId: site.workspaceId, lastSyncedAt: site.lastSyncedAt }, data: { lastSyncedAt: now } });
    if (!claimed.count) continue;
    try { await syncSeoSite(site.workspaceId, site.id, now); }
    catch { await prisma.integrationConnection.updateMany({ where: { id: site.connectionId ?? "", workspaceId: site.workspaceId }, data: { lastError: "Search Console sync failed. Try syncing the site again." } }); }
  }
  // Workspace retention owns inbound-event deletion, including legal hold.
  await prisma.linkCode.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: now } } });
}

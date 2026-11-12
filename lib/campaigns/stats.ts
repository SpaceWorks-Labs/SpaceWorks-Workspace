import "server-only";
import { prisma } from "@/lib/db";

const RETENTION_MONTHS = 13;

/** Delete individual engagement rows older than 13 months. */
export async function purgeOldEngagement(now = new Date()): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS);
  return (await prisma.campaignEngagement.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
}

export type CampaignStats = {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
  progressPct: number;
  opens: number;
  clicks: number;
  uniqueOpens: number;
  bounces: { soft: number; hard: number; complaint: number };
  links: Array<{ id: string; url: string; clicks: number; uniqueClicks: number }>;
};

export async function getCampaignStats(workspaceId: string, campaignId: string): Promise<CampaignStats | null> {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId }, select: { id: true, totalRecipients: true, openCount: true, clickCount: true } });
  if (!campaign) return null;
  const [groups, bounces, links, uniqueOpens] = await Promise.all([
    prisma.campaignMessage.groupBy({ by: ["status"], where: { campaignId, workspaceId }, _count: { _all: true } }),
    prisma.campaignBounce.groupBy({ by: ["kind"], where: { campaignId, workspaceId }, _count: { _all: true } }),
    prisma.campaignLink.findMany({ where: { campaignId, workspaceId }, orderBy: { clickCount: "desc" }, take: 100, select: { id: true, url: true, clickCount: true, uniqueClickCount: true } }),
    prisma.campaignMessage.count({ where: { campaignId, workspaceId, openedAt: { not: null } } }),
  ]);
  const n = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  const b = (k: string) => bounces.find((g) => g.kind === k)?._count._all ?? 0;
  const total = campaign.totalRecipients;
  const done = n("SENT") + n("FAILED") + n("SKIPPED");
  return {
    total,
    pending: n("PENDING") + n("CLAIMED"),
    sent: n("SENT"),
    failed: n("FAILED"),
    skipped: n("SKIPPED"),
    progressPct: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0,
    opens: campaign.openCount,
    clicks: campaign.clickCount,
    uniqueOpens,
    bounces: { soft: b("SOFT"), hard: b("HARD"), complaint: b("COMPLAINT") },
    links: links.map((l) => ({ id: l.id, url: l.url, clicks: l.clickCount, uniqueClicks: l.uniqueClickCount })),
  };
}

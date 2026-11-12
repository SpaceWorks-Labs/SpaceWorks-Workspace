import { prisma } from "@/lib/db";
import { randomToken } from "@/lib/crypto";

const CHUNK = 500;

/**
 * Insert the next chunk of recipients by keyset pagination on subscriber id.
 * Distinct active subscribers with a confirmed subscription on any campaign
 * list; the (campaign, subscriber) unique key makes the insert idempotent.
 * Returns the number of subscribers scanned (0 means the cursor is exhausted).
 * `maxTotal` caps the campaign's recipients (shared SMTP guard).
 */
export async function materialiseChunk(
  campaign: { id: string; workspaceId: string; lastSubscriberId: string | null },
  listIds: string[],
  options: { maxTotal?: number; chunk?: number } = {},
): Promise<number> {
  let take = options.chunk ?? CHUNK;
  if (options.maxTotal !== undefined) {
    const existing = await prisma.campaignMessage.count({ where: { campaignId: campaign.id } });
    take = Math.min(take, options.maxTotal - existing);
    if (take <= 0) return 0;
  }
  const rows = await prisma.subscriber.findMany({
    where: {
      workspaceId: campaign.workspaceId,
      status: "ACTIVE",
      ...(campaign.lastSubscriberId ? { id: { gt: campaign.lastSubscriberId } } : {}),
      subscriptions: { some: { workspaceId: campaign.workspaceId, listId: { in: listIds }, status: "CONFIRMED" } },
    },
    orderBy: { id: "asc" },
    take,
    select: { id: true, email: true },
  });
  if (rows.length === 0) return 0;
  const created = await prisma.campaignMessage.createMany({
    data: rows.map((row) => ({ campaignId: campaign.id, workspaceId: campaign.workspaceId, subscriberId: row.id, emailSnapshot: row.email, token: randomToken(24) })),
    skipDuplicates: true,
  });
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { lastSubscriberId: rows[rows.length - 1]!.id, totalRecipients: { increment: created.count } },
  });
  campaign.lastSubscriberId = rows[rows.length - 1]!.id;
  return rows.length;
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const STALE_CLAIM_MS = 10 * 60_000;
export const STALE_LOCK_MS = 5 * 60_000;

/** Claim up to `limit` due PENDING messages. Concurrent workers never receive the same row. */
export async function claimMessages(campaignId: string, limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "CampaignMessage" SET "status" = 'CLAIMED', "claimedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "CampaignMessage"
      WHERE "campaignId" = ${campaignId} AND "status" = 'PENDING' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
      ORDER BY "createdAt", "id" LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING "id"`);
  return rows.map((row) => row.id);
}

/** Crash recovery: unsent stale claims go back to PENDING; stale claims that did reach the provider are marked SENT. */
export async function recoverStaleClaims(campaignId: string, now = new Date()): Promise<void> {
  const before = new Date(now.getTime() - STALE_CLAIM_MS);
  await prisma.campaignMessage.updateMany({ where: { campaignId, status: "CLAIMED", claimedAt: { lt: before }, providerMessageId: null }, data: { status: "PENDING", claimedAt: null } });
  await prisma.campaignMessage.updateMany({ where: { campaignId, status: "CLAIMED", claimedAt: { lt: before }, providerMessageId: { not: null } }, data: { status: "SENT", sentAt: now } });
}

/** Counters are derived from the message rows, so a crash never leaves them wrong. */
export async function recount(campaignId: string): Promise<{ sent: number; failed: number; skipped: number }> {
  const groups = await prisma.campaignMessage.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } });
  const count = (status: string) => groups.find((group) => group.status === status)?._count._all ?? 0;
  const result = { sent: count("SENT"), failed: count("FAILED"), skipped: count("SKIPPED") };
  await prisma.campaign.update({ where: { id: campaignId }, data: { sentCount: result.sent, failedCount: result.failed, skippedCount: result.skipped } });
  return result;
}

export async function openMessageCount(campaignId: string): Promise<number> {
  return prisma.campaignMessage.count({ where: { campaignId, status: { in: ["PENDING", "CLAIMED"] } } });
}

export async function skipOpenMessages(campaignId: string): Promise<void> {
  await prisma.campaignMessage.updateMany({ where: { campaignId, status: { in: ["PENDING", "CLAIMED"] } }, data: { status: "SKIPPED", lastError: "Campaign cancelled." } });
}

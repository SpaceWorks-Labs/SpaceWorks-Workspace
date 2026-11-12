import "server-only";

import { prisma, type DbClient } from "@/lib/db";

export type WorkspaceUsage = {
  members: number;
  guests: number;
  projects: number;
  storageBytes: number;
  apiTokens: number;
  webhooks: number;
  assistantTokensThisMonth: number;
  emailsThisMonth: number;
};

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Bytes stored: every file row (library, chat, task and document attachments,
 * trash included) plus kept older versions. The current version also has a
 * FileVersion row once a file is versioned, so it is excluded from the sum.
 */
async function storageBytes(db: DbClient, workspaceId: string): Promise<number> {
  const rows = await db.$queryRaw<{ total: bigint }[]>`
    SELECT
      COALESCE((SELECT SUM(f."size") FROM "FileObject" f WHERE f."workspaceId" = ${workspaceId}), 0)
      + COALESCE((SELECT SUM(v."size") FROM "FileVersion" v JOIN "FileObject" f ON f."id" = v."fileId"
                  WHERE f."workspaceId" = ${workspaceId} AND v."storageKey" <> f."storageKey"), 0) AS total`;
  return Number(rows[0]?.total ?? 0);
}

async function assistantTokens(db: DbClient, workspaceId: string, since: Date): Promise<number> {
  const rows = await db.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(COALESCE(m."tokensIn", 0) + COALESCE(m."tokensOut", 0)), 0) AS total
    FROM "AssistantMessage" m JOIN "AssistantConversation" c ON c."id" = m."conversationId"
    WHERE c."workspaceId" = ${workspaceId} AND m."createdAt" >= ${since}`;
  return Number(rows[0]?.total ?? 0);
}

export async function workspaceUsage(workspaceId: string, now = new Date(), db: DbClient = prisma): Promise<WorkspaceUsage> {
  const since = monthStart(now);
  const [members, guests, projects, storage, apiTokens, webhooks, tokens, emails] = await Promise.all([
    db.membership.count({ where: { workspaceId, status: "ACTIVE", role: { not: "GUEST" } } }),
    db.membership.count({ where: { workspaceId, status: "ACTIVE", role: "GUEST" } }),
    db.project.count({ where: { workspaceId, status: { not: "ARCHIVED" } } }),
    storageBytes(db, workspaceId),
    db.apiToken.count({ where: { workspaceId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    db.notificationDestination.count({ where: { workspaceId, kind: "WEBHOOK" } }),
    assistantTokens(db, workspaceId, since),
    db.campaignMessage.count({ where: { workspaceId, status: "SENT", sentAt: { gte: since } } }),
  ]);
  return { members, guests, projects, storageBytes: storage, apiTokens, webhooks, assistantTokensThisMonth: tokens, emailsThisMonth: emails };
}

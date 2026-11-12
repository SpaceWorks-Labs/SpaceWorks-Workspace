import "server-only";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { prisma } from "@/lib/db";
import { syncAccount } from "@/lib/social/sync";
export async function run(now: Date) {
  const off = await workspacesWithoutModule("social");
  await prisma.socialSyncLog.updateMany({ where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - 900000) } }, data: { status: "INTERRUPTED", finishedAt: now, error: "The sync was interrupted. A later sync will retry." } });
  await prisma.socialConnectionDraft.deleteMany({ where: { expiresAt: { lte: now } } });
  await prisma.oAuthState.deleteMany({ where: { provider: { in: ["SOCIAL_YOUTUBE", "SOCIAL_META", "SOCIAL_LINKEDIN", "SOCIAL_X"] }, expiresAt: { lte: now } } });
  const due = await prisma.socialAccount.findMany({ where: { status: { in: ["ACTIVE", "DEGRADED"] }, workspace: { status: "ACTIVE", archivedAt: null }, workspaceId: { notIn: off }, nextSyncAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, select: { id: true, workspaceId: true }, orderBy: { nextSyncAt: "asc" }, take: 5 });
  await Promise.allSettled(due.map(a => syncAccount(a.workspaceId, a.id, now)));
}

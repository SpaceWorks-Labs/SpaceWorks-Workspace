import "server-only";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { memberIdsAtLeast } from "@/lib/approvals/context";
import { workspacesWithoutModule } from "@/lib/modules-server";

export const REMINDER_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

/**
 * Send `asset.maintenance_due` once per maintenance log whose `nextDueAt` is overdue or within the
 * window. The dedupe key (`maintenance:<logId>`) is stored on the notification event record and
 * checked under an advisory lock, so replicas and re-runs never repeat it. A newer SERVICE or
 * INSPECTION on the same asset closes an older due date.
 */
export async function runMaintenanceReminders(now = new Date(), windowDays = REMINDER_WINDOW_DAYS) {
  const off = await workspacesWithoutModule("services");
  let cursor: string | undefined;
  for (;;) {
    const logs = await prisma.assetMaintenanceLog.findMany({
      where: { nextDueAt: { lte: new Date(now.getTime() + windowDays * DAY_MS) }, asset: { status: { not: "RETIRED" }, workspace: { status: "ACTIVE", archivedAt: null, id: { notIn: off } } } },
      include: { asset: { select: { id: true, name: true, workspaceId: true, workspace: { select: { slug: true } } } } },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!logs.length) break;
    for (const log of logs) {
      const dueAt = log.nextDueAt!;
      const key = `maintenance:${log.id}`;
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        if (await tx.notificationEventRecord.findFirst({ where: { workspaceId: log.asset.workspaceId, dedupeKey: key }, select: { id: true } })) return null;
        const closed = await tx.assetMaintenanceLog.findFirst({ where: { assetId: log.assetId, at: { gt: log.at }, type: { in: ["SERVICE", "INSPECTION"] } }, select: { id: true } });
        if (closed) return null;
        return dispatch(
          log.asset.workspaceId,
          {
            type: "asset.maintenance_due",
            title: `${log.asset.name} is ${dueAt <= now ? "overdue for" : "due for"} maintenance`,
            body: log.note.slice(0, 200),
            url: `/w/${log.asset.workspace.slug}/assets#${log.assetId}`,
            recipients: await memberIdsAtLeast(tx, log.asset.workspaceId, "ADMIN"),
            resource: { type: "asset", id: log.assetId },
            dedupeKey: key,
            data: { assetId: log.assetId, dueAt: dueAt.toISOString(), maintenanceLogId: log.id },
          },
          { tx, now },
        );
      });
      await result?.afterCommit();
    }
    cursor = logs.at(-1)!.id;
  }
}

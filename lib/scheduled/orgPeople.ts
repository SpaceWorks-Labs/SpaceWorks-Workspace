import "server-only";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { dayKey, addDays } from "@/lib/community/schedule";
/** Locks plus persistent event markers deduplicate review dates across worker retries. */
export async function run(now: Date) {
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.responsibility.findMany({ where: { status: "ACTIVE", reviewOn: { lte: new Date(now.getTime() + 91 * 86400000) }, workspace: { status: "ACTIVE", archivedAt: null } }, include: { workspace: { select: { slug: true, timezone: true } } }, take: 200, orderBy: { id: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const row of rows) {
      if (row.reviewOn.toISOString().slice(0, 10) > addDays(dayKey(now, row.workspace.timezone), row.reminderDays)) continue;
      const key = `org_people:review:${row.id}:${row.reviewOn.toISOString()}`;
      const result = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`org_people:${row.workspaceId}`}))`;
        const live = await tx.responsibility.findFirst({ where: { workspaceId: row.workspaceId, id: row.id, status: "ACTIVE", reviewOn: row.reviewOn }, select: { accountableId: true, responsibleIds: true, backupId: true } });
        if (!live || await tx.notificationEventRecord.findFirst({ where: { workspaceId: row.workspaceId, dedupeKey: key } })) return null;
        const recipients = await tx.membership.findMany({ where: { workspaceId: row.workspaceId, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null }, userId: { in: [...new Set([live.accountableId, ...live.responsibleIds, ...(live.backupId ? [live.backupId] : [])])] } }, select: { userId: true } });
        if (!recipients.length) return null;
        return dispatch(row.workspaceId, { type: "people.responsibility_review_due", title: "A responsibility review is due", recipients: recipients.map(p => p.userId), resource: { type: "org_responsibility", id: row.id }, url: `/w/${row.workspace.slug}/responsibilities#${row.id}`, useWorkspaceRules: false, dedupeKey: key, data: { responsibilityId: row.id, reviewOn: row.reviewOn.toISOString() } }, { tx, now });
      }, { timeout: 15000 });
      await result?.afterCommit();
    }
    if (rows.length < 200) return; cursor = rows.at(-1)!.id;
  }
}

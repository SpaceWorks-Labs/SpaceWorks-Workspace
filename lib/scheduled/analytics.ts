import "server-only";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { queueMonthlyReport } from "@/lib/analytics/email";
import { querySchema } from "@/lib/analytics/metrics";
import { localDate } from "@/lib/finance/dates";
/** One generic reminder per adjustment/date, claimed under the tenant lock. */
export async function run(now = new Date()) {
  const off = await workspacesWithoutModule("analytics");
  let cursor: string | undefined;
  for (;;) {
    const workspaces = await prisma.workspace.findMany({
      where: {
        archivedAt: null,
        id: { notIn: off },
        OR: [
          { analyticsAdjustments: { some: {} } },
          { analyticsPresets: { some: { shared: true } } },
        ],
      },
      select: { id: true, slug: true, timezone: true },
      orderBy: { id: "asc" },
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!workspaces.length) break;
    for (const ws of workspaces) {
      const month = localDate(now, ws.timezone).slice(0, 7),
        presets = await prisma.analyticsPreset.findMany({
          where: { workspaceId: ws.id, shared: true },
          select: { id: true, ownerId: true, query: true },
        });
      for (const p of presets) {
        const q = querySchema.safeParse(p.query);
        if (!q.success || !q.data.monthlyEmail) continue;
        if (
          await prisma.auditEvent.count({
            where: {
              workspaceId: ws.id,
              action: "analytics.monthly_queued",
              targetId: p.id,
              metadata: { path: ["month"], equals: month },
            },
          })
        )
          continue;
        try {
          await queueMonthlyReport(
            {
              workspace: ws,
              user: { id: p.ownerId },
              membership: { role: "GUEST" },
            },
            p.id,
            month,
            now,
          );
        } catch {
          console.error("[analytics] Could not prepare a monthly report.");
        }
      }
      const events = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${ws.id} AND "archivedAt" IS NULL FOR NO KEY UPDATE`;
        if (
          !(await tx.workspace.count({
            where: { id: ws.id, archivedAt: null },
          }))
        )
          return [];
        const today = localDate(now, ws.timezone),
          rows = await tx.analyticsAdjustment.findMany({
            where: { workspaceId: ws.id, dueOn: new Date(today) },
            select: { id: true },
          }),
          admins = await tx.membership.findMany({
            where: {
              workspaceId: ws.id,
              status: "ACTIVE",
              role: { in: ["OWNER", "ADMIN"] },
              user: { disabledAt: null },
            },
            select: { userId: true },
          }),
          results = [];
        for (const row of rows) {
          const key = `analytics.assumption_due:${row.id}:${today}`;
          if (
            await tx.notificationEventRecord.count({
              where: { workspaceId: ws.id, dedupeKey: key },
            })
          )
            continue;
          results.push(
            await dispatch(
              ws.id,
              {
                type: "analytics.assumption_due",
                title: "Review a cash forecast assumption",
                body: "A one-off cash assumption is due today. Confirm the source record or update the forecast.",
                url: `/w/${ws.slug}/analytics?section=finance#adjustments`,
                recipients: admins.map((m) => m.userId),
                useWorkspaceRules: false,
                dedupeKey: key,
                resource: { type: "analytics_adjustment", id: row.id },
                data: { adjustmentId: row.id, dueOn: today },
              },
              { tx, now },
            ),
          );
        }
        return results;
      });
      for (const e of events) await e.afterCommit();
    }
    cursor = workspaces.at(-1)!.id;
  }
}

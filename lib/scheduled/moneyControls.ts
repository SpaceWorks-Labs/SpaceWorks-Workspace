import "server-only";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { localDate } from "@/lib/finance/dates";
import { sectionFor } from "@/lib/moneyControls/rules";
import { canReadMoneyControl } from "@/lib/roles";
/** Persisted claims, live record checks and transaction locks deduplicate replica reminders. */
export async function run(now: Date) {
  const off = await workspacesWithoutModule("finance");
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.moneyControlRecord.findMany({
      where: {
        workspace: { status: "ACTIVE", archivedAt: null },
        workspaceId: { notIn: off },
        dueOn: { not: null },
        status: {
          notIn: [
            "CANCELLED",
            "RETURNED",
            "CONFIRMED",
            "PAID",
            "RECORDED",
            "POSTED",
          ],
        },
      },
      include: { workspace: { select: { slug: true, timezone: true } } },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      const days = Math.round(
        (+row.dueOn! - +new Date(localDate(now, row.workspace.timezone))) /
          86400000,
      );
      if (days > row.reminderDays) continue;
      const key = `moneycontrols:${row.id}:${row.dueOn!.toISOString().slice(0, 10)}:${days < 0 ? "overdue" : "due"}`;
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        if (
          await tx.notificationEventRecord.findFirst({
            where: { workspaceId: row.workspaceId, dedupeKey: key },
          })
        )
          return null;
        if (
          !(await tx.moneyControlRecord.findFirst({
            where: {
              workspaceId: row.workspaceId,
              id: row.id,
              updatedAt: row.updatedAt,
              workspace: { status: "ACTIVE", archivedAt: null },
            },
          }))
        )
          return null;
        const members = await tx.membership.findMany({
          where: {
            workspaceId: row.workspaceId,
            status: "ACTIVE",
            user: { disabledAt: null },
          },
          select: { userId: true, role: true },
        });
        const grants = row.payroll
          ? await tx.financePayrollGrant.findMany({
              where: { workspaceId: row.workspaceId },
              select: { userId: true },
            })
          : [];
        const allowed = members.filter(
          (m) =>
            canReadMoneyControl(m, m.userId, row) &&
            (!row.payroll || grants.some((g) => g.userId === m.userId)),
        );
        const recipients =
          row.ownerId && allowed.some((m) => m.userId === row.ownerId)
            ? [row.ownerId]
            : allowed
                .filter((m) => ["ADMIN", "OWNER"].includes(m.role))
                .map((m) => m.userId);
        return dispatch(
          row.workspaceId,
          {
            type: "moneycontrols.reminder",
            title: "An internal control record needs review",
            body: "Review its due date, status and supporting proof.",
            url: `/w/${row.workspace.slug}/money-controls/${sectionFor(row.kind)}?edit=${row.id}`,
            recipients,
            resource: { type: "money_control", id: row.id },
            useWorkspaceRules: false,
            dedupeKey: key,
            data: { recordId: row.id, dueOn: row.dueOn!.toISOString() },
          },
          { tx, now },
        );
      });
      await result?.afterCommit();
    }
    cursor = rows.at(-1)!.id;
  }
}

import "server-only";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { FinanceError, lockFinance } from "@/lib/finance/tools/access";
import {
  createRemittances,
  generateSchedule,
} from "@/lib/finance/recurring/service";
import { localDate } from "@/lib/finance/dates";
import { dispatch } from "@/lib/notify";
export async function run(now = new Date()) {
  const off = await workspacesWithoutModule("finance");
  let cursor: string | undefined;
  for (;;) {
    const spaces = await prisma.workspace.findMany({
      where: { archivedAt: null, id: { notIn: off } },
      select: { id: true, slug: true, timezone: true },
      orderBy: { id: "asc" },
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!spaces.length) break;
    for (const ws of spaces) {
      // Generation and reminders share the bill payment lock, so replica ticks cannot race.
      const callbacks = await prisma.$transaction(
        async (tx) => {
          await lockFinance(tx, ws.id);
          if (
            !(await tx.workspace.findFirst({
              where: { id: ws.id, archivedAt: null },
            }))
          )
            return [];
          const today = new Date(localDate(now, ws.timezone));
          const schedules = await tx.recurringCostSchedule.findMany({
            where: { workspaceId: ws.id, status: "ACTIVE" },
            orderBy: { nextDueOn: "asc" },
          });
          const blockedIds: string[] = [];
          for (const s of schedules) {
            await tx.$executeRawUnsafe("SAVEPOINT recurring_schedule");
            try {
              await generateSchedule(tx, s, today);
              await tx.$executeRawUnsafe(
                "RELEASE SAVEPOINT recurring_schedule",
              );
            } catch (error) {
              await tx.$executeRawUnsafe(
                "ROLLBACK TO SAVEPOINT recurring_schedule",
              );
              await tx.$executeRawUnsafe(
                "RELEASE SAVEPOINT recurring_schedule",
              );
              if (!(error instanceof FinanceError)) throw error;
              blockedIds.push(s.id);
              await tx.recurringCostSchedule.updateMany({
                where: { workspaceId: ws.id, id: s.id },
                data: { status: "PAUSED" },
              });
              await recordAuditEvent({
                client: tx,
                workspaceId: ws.id,
                action: "finance.recurring_generation_blocked",
                targetType: "recurring_cost",
                targetId: s.id,
                metadata: { reason: error.message },
              });
            }
          }
          const runs = await tx.financePayRun.findMany({
            where: {
              workspaceId: ws.id,
              status: "PAID",
              OR: [
                { pfMinor: { gt: 0 } },
                { esiMinor: { gt: 0 } },
                { ptMinor: { gt: 0 } },
                { tdsMinor: { gt: 0 } },
              ],
            },
          });
          for (const run of runs) await createRemittances(tx, run);
          const members = await tx.membership.findMany({
            where: {
              workspaceId: ws.id,
              status: "ACTIVE",
              role: { not: "GUEST" },
              user: { disabledAt: null },
            },
            select: { userId: true, role: true },
          });
          const grants = await tx.financePayrollGrant.findMany({
            where: { workspaceId: ws.id, manage: true },
            select: { userId: true },
          });
          const payroll = members
              .filter((m) => grants.some((g) => g.userId === m.userId))
              .map((m) => m.userId),
            admins = members
              .filter((m) => ["OWNER", "ADMIN"].includes(m.role))
              .map((m) => m.userId);
          const bills = await tx.financeBill.findMany({
            where: {
              workspaceId: ws.id,
              paidMinor: { lt: tx.financeBill.fields.amountMinor },
              dueOn: { lte: new Date(+today + 90 * 86400000) },
            },
            include: { recurringDue: { include: { schedule: true } } },
          });
          const reminders: Array<{
            id: string;
            date: Date;
            lead: number;
            recipients: string[];
            url: string;
            kind: string;
          }> = [];
          for (const id of blockedIds)
            reminders.push({
              id,
              date: today,
              lead: 0,
              recipients: admins,
              url: `/w/${ws.slug}/finance/recurring?edit=${id}`,
              kind: "blocked",
            });
          for (const b of bills)
            reminders.push({
              id: b.id,
              date: b.dueOn,
              lead: b.recurringDue?.schedule?.reminderDays ?? 7,
              recipients: b.privatePayroll ? payroll : admins,
              url: `/w/${ws.slug}/finance/${b.privatePayroll ? "payroll/dues" : "dues"}`,
              kind: "bill",
            });
          const projected = await tx.recurringCostSchedule.findMany({
            where: { workspaceId: ws.id, status: "ACTIVE" },
          });
          for (const s of projected)
            if (s.reminderDays > s.leadDays)
              reminders.push({
                id: s.id,
                date: s.nextDueOn,
                lead: s.reminderDays,
                recipients: admins,
                url: `/w/${ws.slug}/finance/recurring?edit=${s.id}`,
                kind: "schedule",
              });
          for (const s of projected)
            if (s.kind === "RENT" && s.renewalOn)
              reminders.push({
                id: s.id,
                date: s.renewalOn,
                lead: s.renewalReminderDays,
                recipients: admins,
                url: `/w/${ws.slug}/finance/recurring?edit=${s.id}`,
                kind: "renewal",
              });
          const recoveries = await tx.staffAdvanceRecovery.findMany({
            where: {
              workspaceId: ws.id,
              recoveredMinor: {
                lt: tx.staffAdvanceRecovery.fields.amountMinor,
              },
              advance: { status: "PAID" },
            },
            include: { advance: { select: { userId: true } } },
          });
          for (const r of recoveries)
            reminders.push({
              id: r.id,
              date: r.dueOn,
              lead: 7,
              recipients: [
                ...new Set([
                  ...payroll,
                  ...members
                    .filter((m) => m.userId === r.advance.userId)
                    .map((m) => m.userId),
                ]),
              ],
              url: `/w/${ws.slug}/finance/advances`,
              kind: "recovery",
            });
          const after: Array<() => Promise<void>> = [];
          for (const r of reminders) {
            const days = Math.round((+r.date - +today) / 86400000);
            if (days > r.lead || !r.recipients.length) continue;
            const key = `recurring:${r.kind}:${r.id}:${r.date.toISOString().slice(0, 10)}:${days < 0 ? `overdue:${today.toISOString().slice(0, 10)}` : "due"}`;
            if (
              await tx.notificationEventRecord.findFirst({
                where: { workspaceId: ws.id, dedupeKey: key },
              })
            )
              continue;
            const sent = await dispatch(
              ws.id,
              {
                type: "finance.recurring.due",
                title:
                  r.kind === "renewal"
                    ? "Review rent before lease renewal"
                    : days < 0
                      ? "A finance due is overdue"
                      : "A finance due needs review",
                body:
                  r.kind === "renewal"
                    ? "Agree the new rent and update future schedule amounts."
                    : "Review the due date, amount and supporting proof.",
                url: r.url,
                recipients: r.recipients,
                resource: { type: "recurring_cost", id: r.id },
                useWorkspaceRules: false,
                dedupeKey: key,
                data: { recordId: r.id, dueOn: r.date.toISOString() },
              },
              { tx, now },
            );
            after.push(sent.afterCommit);
          }
          return after;
        },
        { timeout: 60000 },
      );
      for (const callback of callbacks) await callback();
    }
    cursor = spaces.at(-1)!.id;
  }
}

import "server-only";

import { prisma } from "@/lib/db";
import type { DashboardWindow } from "./compute";
import type { OrgUsageRow, PaymentRow, Trend, UsageTotals } from "./types";

type Range = { gte: Date; lt?: Date };

async function trend(count: (range: Range) => Promise<number>, w: DashboardWindow): Promise<Trend> {
  const [current, previous] = await Promise.all([count({ gte: w.since }), count({ gte: w.previousSince, lt: w.since })]);
  return { current, previous };
}

async function assistantTokens(range: Range): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(COALESCE("tokensIn", 0) + COALESCE("tokensOut", 0)), 0)::bigint AS total FROM "AssistantMessage"
    WHERE "createdAt" >= ${range.gte}::timestamp AND (${range.lt ?? null}::timestamp IS NULL OR "createdAt" < ${range.lt ?? null}::timestamp)`;
  return Number(rows[0]?.total ?? 0);
}

/**
 * Instance-wide totals for the period. Transactional mail is the outbox (it has
 * no organisation column, so it is instance-wide only); campaign mail is
 * per organisation. Payments are paid amounts in integer minor units per
 * provider and currency, never provider ids or secrets.
 */
export async function loadUsageTotals(w: DashboardWindow, rows: OrgUsageRow[]): Promise<UsageTotals> {
  const [campaignSent, transactionalSent, byKind, assistantUsed, tasksCreated, paid, links] = await Promise.all([
    trend((sentAt) => prisma.campaignMessage.count({ where: { status: "SENT", sentAt } }), w),
    trend((sentAt) => prisma.outboxMessage.count({ where: { status: "SENT", sentAt } }), w),
    prisma.outboxMessage.groupBy({ by: ["kind"], where: { status: "SENT", sentAt: { gte: w.since } }, _count: { _all: true } }),
    trend(assistantTokens, w),
    trend((createdAt) => prisma.task.count({ where: { createdAt } }), w),
    prisma.invoicePayment.groupBy({
      by: ["provider", "currency"],
      where: { paidAt: { gte: w.since }, status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } },
      _count: { _all: true }, _sum: { amountMinor: true, refundedMinor: true },
    }),
    prisma.invoicePayment.groupBy({ by: ["status"], where: { createdAt: { gte: w.since } }, _count: { _all: true } }),
  ]);
  const payments: PaymentRow[] = paid
    .map((row) => ({ provider: row.provider, currency: row.currency, paidCount: row._count._all, paidMinor: row._sum.amountMinor ?? 0, refundedMinor: row._sum.refundedMinor ?? 0 }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.provider.localeCompare(b.provider));
  return {
    campaignSent, transactionalSent, assistantUsed, tasksCreated,
    transactionalByKind: byKind.map((row) => ({ kind: row.kind, count: row._count._all })).sort((a, b) => b.count - a.count).slice(0, 8),
    storageBytes: rows.reduce((sum, row) => sum + row.storageBytes, 0),
    openProjects: rows.reduce((sum, row) => sum + row.projects, 0),
    payments,
    paymentLinks: links.map((row) => ({ status: row.status, count: row._count._all })).sort((a, b) => b.count - a.count),
  };
}

import "server-only";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { run as financeTools } from "@/lib/scheduled/financeTools";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format/datetime";
import { dateOnly, localDate } from "@/lib/finance/dates";
import { dispatch } from "@/lib/notify";

/** One notice per invoice due date, committed with an audit marker under a row lock. */
export async function notifyOverdueInvoices(now: Date): Promise<number> {
  const off = await workspacesWithoutModule("finance");
  // Exclude completed notices before LIMIT so old overdue invoices cannot starve newer ones.
  // Date-only due dates become overdue at midnight in each workspace's time zone.
  const candidates = await prisma.$queryRaw<Array<{ id: string; workspaceId: string }>>`
    SELECT i."id", i."workspaceId" FROM "Invoice" i
    JOIN "Workspace" w ON w."id" = i."workspaceId"
    WHERE i."status" = 'SENT' AND w."archivedAt" IS NULL AND NOT (i."workspaceId" = ANY(${off}))
      AND i."dueOn" < (${now}::timestamptz AT TIME ZONE w."timezone")::date
      AND NOT EXISTS (
        SELECT 1 FROM "AuditEvent" a
        WHERE a."workspaceId" = i."workspaceId" AND a."targetId" = i."id"
          AND a."action" = 'finance.invoice_overdue'
          AND a."metadata"->>'dueOn' = to_char(i."dueOn", 'YYYY-MM-DD')
      )
    ORDER BY i."dueOn", i."id" LIMIT 50`;
  let count = 0;
  for (const candidate of candidates) {
    const notice = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${candidate.id} AND "workspaceId" = ${candidate.workspaceId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({ where: { id: candidate.id, workspaceId: candidate.workspaceId }, include: { workspace: true } });
      if (!invoice || invoice.status !== "SENT" || !invoice.dueOn || invoice.workspace.archivedAt || invoice.workspace.status !== "ACTIVE") return null;
      const { workspace } = invoice;
      const dueOn = invoice.dueOn.toISOString().slice(0, 10);
      if (invoice.dueOn >= dateOnly(localDate(now, workspace.timezone))) return null;
      const prior = await tx.auditEvent.findFirst({ where: { workspaceId: workspace.id, action: "finance.invoice_overdue", targetId: invoice.id, metadata: { path: ["dueOn"], equals: dueOn } }, select: { id: true } });
      if (prior) return null;
      const result = await dispatch(workspace.id, {
        type: "invoice.overdue",
        title: `Invoice ${invoice.number} is overdue`,
        body: `Payment was due ${formatDate(invoice.dueOn, "UTC")}. Check with the client.`,
        url: `/w/${workspace.slug}/finance/invoices/${invoice.id}`,
        resource: { type: "invoice", id: invoice.id },
        dedupeKey: `invoice.overdue:${invoice.id}:${dueOn}`,
        data: { invoiceId: invoice.id, number: invoice.number, dueOn: invoice.dueOn.toISOString() },
      }, { tx, now });
      await recordAuditEvent({ workspaceId: workspace.id, action: "finance.invoice_overdue", targetType: "invoice", targetId: invoice.id, metadata: { dueOn }, client: tx, ip: null });
      return result;
    });
    if (notice) {
      await notice.afterCommit();
      count += 1;
    }
  }
  return count;
}

/** Runs on every replica; conditional claims and row locks make the job idempotent. */
export async function run(now: Date): Promise<void> {
  await notifyOverdueInvoices(now);
  await financeTools(now);
}

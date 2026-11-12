import "server-only";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { purgeExpiredStagedFiles } from "@/lib/finance/tools/files";
import { prisma, type Tx } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { dispatch } from "@/lib/notify";
import type { AnyNotificationEvent } from "@/lib/notify/types";
import { dateOnly, localDate } from "@/lib/finance/dates";
import { toolSchemas } from "@/lib/finance/tools-rules";
import {
  FinanceError,
  financeAccess,
  lockFinance,
  type FinanceActor,
} from "@/lib/finance/tools/access";

async function once(
  tx: Tx,
  workspaceId: string,
  key: string,
  event: AnyNotificationEvent,
  now: Date,
) {
  if (
    await tx.auditEvent.findFirst({
      where: { workspaceId, action: "finance.reminder_sent", targetId: key },
      select: { id: true },
    })
  )
    return null;
  const notice = await dispatch(
    workspaceId,
    { ...event, useWorkspaceRules: false, dedupeKey: key },
    { tx, now },
  );
  await recordAuditEvent({
    workspaceId,
    action: "finance.reminder_sent",
    targetType: "finance_reminder",
    targetId: key,
    client: tx,
    ip: null,
  });
  return notice.afterCommit;
}
export async function saveReviewRule(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.threshold.parse(input);
  const c = await prisma.financeCategory.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      id: v.categoryId,
      kind: "EXPENSE",
      archivedAt: null,
    },
  });
  if (!c)
    throw new FinanceError("Choose an expense category in this workspace.");
  const row = await prisma.financeReviewRule.upsert({
    where: {
      workspaceId_categoryId_currency: {
        workspaceId: actor.workspace.id,
        categoryId: v.categoryId,
        currency: v.currency,
      },
    },
    create: { workspaceId: actor.workspace.id, ...v },
    update: { thresholdMinor: v.thresholdMinor },
  });
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: "finance.review_threshold_saved",
    targetType: "finance_review_rule",
    targetId: row.id,
  });
  return row.id;
}
export async function remindReceipt(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.remind.parse(input);
  const callback = await prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const e = await tx.ledgerEntry.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: v.entryId,
        kind: "EXPENSE",
        voidedAt: null,
        privatePayroll: false,
      },
      include: { receiptFile: { select: { deletedAt: true } } },
    });
    if (!e?.createdById)
      throw new FinanceError("That entry has no active logger to remind.");
    if (e.receiptFile && !e.receiptFile.deletedAt)
      throw new FinanceError("This entry already has a receipt.");
    const files = await tx.financeAttachment.count({
      where: {
        workspaceId: actor.workspace.id,
        recordType: "LEDGER",
        recordId: e.id,
        file: { deletedAt: null },
      },
    });
    if (files || (["cash_voucher","asset_disposal"].includes(e.sourceType??"") && await tx.moneyControlAttachment.count({where:{workspaceId:actor.workspace.id,recordId:e.sourceId!,file:{deletedAt:null}}}))) throw new FinanceError("This entry already has a receipt.");
    const day = localDate(new Date(), actor.workspace.timezone);
    return once(
      tx,
      actor.workspace.id,
      `receipt:${e.id}:${day}`,
      {
        type: "finance.receipt.missing",
        title: "Add the missing receipt to your expense",
        url: `/w/${actor.workspace.slug}/finance/spending`,
        recipients: [e.createdById],
        resource: { type: "ledger_entry", id: e.id },
        data: { entryId: e.id },
      },
      new Date(),
    );
  });
  await callback?.();
  return v.entryId;
}
export async function run(now: Date): Promise<void> {
  const off = await workspacesWithoutModule("finance");
  const workspaces = await prisma.workspace.findMany({
    where: { archivedAt: null, id: { notIn: off } },
    select: { id: true, slug: true, timezone: true },
  });
  for (const ws of workspaces) {
    const callbacks = await prisma.$transaction(
      async (tx) => {
        await lockFinance(tx, ws.id);
        await purgeExpiredStagedFiles(tx, ws.id, now);
        const after: Array<() => Promise<void>> = [];
        const day = localDate(now, ws.timezone),
          month = day.slice(0, 7);
        const admins = (
          await tx.membership.findMany({
            where: {
              workspaceId: ws.id,
              status: "ACTIVE",
              role: { in: ["ADMIN", "OWNER"] },
              user: { disabledAt: null },
            },
            select: { userId: true },
          })
        ).map((m) => m.userId);
        const bills = await tx.financeBill.findMany({
          where: {
            workspaceId: ws.id,
            privatePayroll: false,
            dueOn: { lt: dateOnly(day) },
            paidMinor: { lt: tx.financeBill.fields.amountMinor },
          },
          orderBy: { dueOn: "asc" },
        });
        for (const bill of bills) {
          const fn = await once(
            tx,
            ws.id,
            `bill:${bill.id}:${day}`,
            {
              type: "finance.bill.overdue",
              title: "A supplier bill is overdue",
              recipients: bill.ownerId
                ? [...new Set([...admins, bill.ownerId])]
                : admins,
              url: `/w/${ws.slug}/finance/bills`,
              data: { billId: bill.id, dueOn: bill.dueOn.toISOString() },
            },
            now,
          );
          if (fn) after.push(fn);
        }
        const review = await tx.financeMonth.findUnique({
          where: { workspaceId_month: { workspaceId: ws.id, month } },
        });
        if (Number(day.slice(-2)) >= 25 && !review?.reviewSignedAt) {
          const fn = await once(
            tx,
            ws.id,
            `spend-review:${month}`,
            {
              type: "finance.month.review_due",
              title: "Review this month's spending",
              recipients: admins,
              url: `/w/${ws.slug}/finance/spending?month=${month}`,
              data: { month },
            },
            now,
          );
          if (fn) after.push(fn);
        }
        const payouts = await tx.financeDisbursement.findMany({
          where: {
            workspaceId: ws.id,
            dueOn: { lte: dateOnly(day) },
            status: { not: "PAID" },
          },
        });
        for (const payout of payouts) {
          const fn = await once(
            tx,
            ws.id,
            `payout:${payout.id}:${day}`,
            {
              type: "finance.disbursement.due",
              title: "A disbursement is due",
              recipients: admins,
              url: `/w/${ws.slug}/finance/disbursements`,
              data: { disbursementId: payout.id },
            },
            now,
          );
          if (fn) after.push(fn);
        }
        // Receipt reminders stay generic and only go to the logger, once per week.
        const expenses = await tx.ledgerEntry.findMany({
          where: {
            workspaceId: ws.id,
            kind: "EXPENSE",
            privatePayroll: false,
            voidedAt: null,
            receiptFileId: null,
            occurredOn: { gte: dateOnly(`${month}-01`), lt: dateOnly(day) },
            sourceType: null,
          },
          select: { id: true, createdById: true },
        });
        const attached = new Set(
          (
            await tx.financeAttachment.findMany({
              where: {
                workspaceId: ws.id,
                recordType: "LEDGER",
                recordId: { in: expenses.map((e) => e.id) },
                file: { deletedAt: null },
              },
              select: { recordId: true },
            })
          ).map((a) => a.recordId),
        );
        for (const e of expenses)
          if (e.createdById && !attached.has(e.id)) {
            const fn = await once(
              tx,
              ws.id,
              `receipt:${e.id}:week-${Math.floor(+dateOnly(day) / 604800000)}`,
              {
                type: "finance.receipt.missing",
                title: "Add the missing receipt to your expense",
                recipients: [e.createdById],
                url: `/w/${ws.slug}/finance/spending`,
                data: { entryId: e.id },
              },
              now,
            );
            if (fn) after.push(fn);
          }
        return after;
      },
      { timeout: 60000 },
    );
    for (const fn of callbacks) await fn();
  }
}

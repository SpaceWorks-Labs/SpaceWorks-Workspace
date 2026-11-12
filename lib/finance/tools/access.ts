import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import {
  canManageFinance,
  canManagePayroll,
  canViewFinance,
  canViewPayroll,
  hasRoleAtLeast,
} from "@/lib/roles";
import type { Workspace, WorkspaceRole } from "@prisma/client";
import type { AttachmentType } from "@/lib/finance/tools-rules";
import { recordAuditEvent } from "@/lib/audit";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";

export type FinanceActor = {
  user: { id: string; name: string | null };
  workspace: Pick<Workspace, "id" | "slug" | "name" | "currency" | "timezone">;
  membership: { role: WorkspaceRole; viaSuperAdmin?: boolean };
};
export class FinanceError extends Error {}
export const unavailable =
  "That finance record is unavailable. Refresh and try again.";

/** Re-read membership so stale UI and internal callers cannot retain revoked access. */
export async function financeAccess(
  actor: FinanceActor,
  mode: "VIEW" | "MANAGE" | "PAY_VIEW" | "PAY_MANAGE" | "OWNER" = "VIEW",
  client: DbClient = prisma,
) {
  const member = await activeMemberOrSuperAdmin(client, actor);
  if (!member || !hasRoleAtLeast(member.role, "MEMBER"))
    throw new FinanceError("You don't have access to do that.");
  const grant = await client.financePayrollGrant.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: actor.workspace.id,
        userId: actor.user.id,
      },
    },
  });
  const payrollView = canViewPayroll(member, grant),
    payrollManage = canManagePayroll(member, grant);
  const allowed =
    mode === "OWNER"
      ? member.role === "OWNER"
      : mode === "PAY_VIEW"
        ? payrollView
        : mode === "PAY_MANAGE"
          ? payrollManage
          : mode === "MANAGE"
            ? canManageFinance(member)
            : canViewFinance(member, member.workspace);
  if (!allowed) throw new FinanceError("You don't have access to do that.");
  return { member, grant, payrollView, payrollManage };
}

export async function auditPayView(
  actor: FinanceActor,
  type: string,
  id: string,
  client: DbClient = prisma,
) {
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: "finance.payroll_viewed",
    targetType: type,
    targetId: id,
    client,
  });
}

/** Polymorphic links are never used without resolving the owning tenant record. */
export async function recordAccess(
  actor: FinanceActor,
  type: AttachmentType,
  recordId: string,
  write = false,
  client: DbClient = prisma,
) {
  if (type === "PAY_PROFILE" || type === "PAY_RUN") {
    await financeAccess(actor, write ? "PAY_MANAGE" : "PAY_VIEW", client);
    const where = { id: recordId, workspaceId: actor.workspace.id };
    const row =
      type === "PAY_PROFILE"
        ? await client.financePayProfile.findFirst({
            where,
            select: { id: true },
          })
        : await client.financePayRun.findFirst({ where, select: { id: true } });
    if (!row) throw new FinanceError(unavailable);
    if (!write) await auditPayView(actor, type, recordId, client);
    return;
  }
  if (type === "ADVANCE") {
    const { readAdvance } = await import("@/lib/finance/recurring/advances");
    await readAdvance(actor, recordId, write, client);
    return;
  }
  const privateBill =
    type === "BILL" &&
    (await client.financeBill.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: recordId,
        privatePayroll: true,
      },
    }));
  if (privateBill) {
    await financeAccess(actor, write ? "PAY_MANAGE" : "PAY_VIEW", client);
    if (!write) await auditPayView(actor, "remittance", recordId, client);
    return;
  }
  await financeAccess(actor, write ? "MANAGE" : "VIEW", client);
  const where = { id: recordId, workspaceId: actor.workspace.id };
  let exists: unknown;
  switch (type) {
    case "STAGED":
      exists = recordId === actor.user.id || /^[0-9a-f-]{36}$/i.test(recordId);
      break;
    case "LEDGER": {
      const row = await client.ledgerEntry.findFirst({ where });
      if (row?.privatePayroll) {
        await financeAccess(actor, write ? "PAY_MANAGE" : "PAY_VIEW", client);
        if (!write) await auditPayView(actor, "ledger_entry", row.id, client);
      }
      exists = row;
      break;
    }
    case "RECURRING":
      await financeAccess(actor, "MANAGE", client);
      exists = await client.recurringCostSchedule.findFirst({ where });
      break;
    case "BILL": {
      const bill = await client.financeBill.findFirst({ where });
      if (bill?.privatePayroll) {
        await financeAccess(actor, write ? "PAY_MANAGE" : "PAY_VIEW", client);
        if (!write) await auditPayView(actor, "remittance", recordId, client);
      }
      exists = bill;
      break;
    }
    case "FUND":
      exists = await client.financeFund.findFirst({ where });
      break;
    case "DISBURSEMENT":
      exists = await client.financeDisbursement.findFirst({ where });
      break;
    case "MONTH":
      exists = await client.financeMonth.findFirst({ where });
      break;
  }
  if (!exists) throw new FinanceError(unavailable);
}

export async function validateMember(
  client: DbClient,
  workspaceId: string,
  userId: string | null,
) {
  if (
    userId &&
    !(await client.membership.findFirst({
      where: {
        workspaceId,
        userId,
        status: "ACTIVE",
        user: { disabledAt: null },
      },
      select: { id: true },
    }))
  )
    throw new FinanceError("Choose an active member in this workspace.");
}

export async function validateTags(
  client: DbClient,
  workspaceId: string,
  tags: {
    fundId?: string | null;
    costCentreId?: string | null;
    accountId?: string | null;
    categoryId?: string | null;
    budgetId?: string | null;
  },
  currency: string,
  kind?: "INCOME" | "EXPENSE",
) {
  if (
    tags.fundId &&
    !(await client.financeFund.findFirst({
      where: { id: tags.fundId, workspaceId, currency, archivedAt: null },
    }))
  )
    throw new FinanceError("Choose an active fund in the record's currency.");
  if (
    tags.costCentreId &&
    !(await client.financeCostCentre.findFirst({
      where: { id: tags.costCentreId, workspaceId, archivedAt: null },
    }))
  )
    throw new FinanceError("Choose an active cost centre in this workspace.");
  if (
    tags.accountId &&
    !(await client.financeAccount.findFirst({
      where: { id: tags.accountId, workspaceId, currency },
    }))
  )
    throw new FinanceError("Choose an account in the record's currency.");
  if (
    tags.categoryId &&
    !(await client.financeCategory.findFirst({
      where: {
        id: tags.categoryId,
        workspaceId,
        archivedAt: null,
        ...(kind ? { kind } : {}),
      },
    }))
  )
    throw new FinanceError("Choose a matching category in this workspace.");
  if (
    tags.budgetId &&
    !(await client.budget.findFirst({
      where: { id: tags.budgetId, workspaceId, currency },
    }))
  )
    throw new FinanceError("Choose a budget in the record's currency.");
}

/** One workspace lock serialises closing a month with backdated edits and payments. */
export async function lockFinance(client: DbClient, workspaceId: string) {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-tools:${workspaceId}`}))`;
}
export async function assertOpen(
  client: DbClient,
  workspaceId: string,
  date: Date,
  accountId?: string | null,
) {
  if (
    accountId &&
    (await client.financeAccount.findFirst({
      where: { workspaceId, id: accountId, openingOn: { gt: date } },
    }))
  )
    throw new FinanceError("Use a date on or after the account opening date.");
  const month = date.toISOString().slice(0, 7);
  if (
    await client.financeMonth.findFirst({
      where: { workspaceId, month, signedOffAt: { not: null } },
    })
  )
    throw new FinanceError(
      "This month is signed off. Reopen it before changing entries.",
    );
  if (
    accountId &&
    (await client.financeAccount.findFirst({
      where: { workspaceId, id: accountId, reconciledUpTo: { gte: date } },
    }))
  )
    throw new FinanceError(
      "This account is reconciled through that date. Use an open period.",
    );
}

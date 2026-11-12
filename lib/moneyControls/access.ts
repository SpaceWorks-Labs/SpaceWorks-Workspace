import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import {
  canManageMoneyControls,
  canReadMoneyControl,
  canManagePayroll,
  canViewPayroll,
  hasRoleAtLeast,
} from "@/lib/roles";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { FinanceError, type FinanceActor } from "@/lib/finance/tools/access";
import { payrollDisabled } from "@/lib/finance/tools/payrollGate";
import type { MoneyControlRecord } from "@prisma/client";
export type ControlsActor = FinanceActor;
export async function controlsAccess(
  actor: ControlsActor,
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
  // The super admin can switch the finance.payroll sub-area off; then nobody sees or changes payroll records.
  const payrollOn = !(await payrollDisabled(actor.workspace.id));
  return {
    member,
    manage: canManageMoneyControls(member),
    payrollView: payrollOn && canViewPayroll(member, grant),
    payrollManage: payrollOn && canManagePayroll(member, grant),
  };
}
export async function controlRecord(
  actor: ControlsActor,
  recordId: string,
  write = false,
  client: DbClient = prisma,
) {
  const a = await controlsAccess(actor, client);
  const row = await client.moneyControlRecord.findFirst({
    where: { workspaceId: actor.workspace.id, id: recordId },
  });
  if (
    !row ||
    !canReadMoneyControl(a.member, actor.user.id, row) ||
    (write && !a.manage) ||
    (row.payroll && !(write ? a.payrollManage : a.payrollView))
  )
    throw new FinanceError(
      "That control record is unavailable. Refresh and try again.",
    );
  if(write && /^(staff-advance:|emi:)/.test(row.recordKey??"")) throw new FinanceError("Manage this cash movement from Recurring costs or Payroll advances.");
  return row;
}
export function details(row: Pick<MoneyControlRecord, "details">) {
  return row.details as Record<string, unknown>;
}

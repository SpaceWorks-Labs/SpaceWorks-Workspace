import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import {
  auditPayView,
  financeAccess,
  FinanceError,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { canReadStaffAdvance } from "@/lib/roles";

export async function readAdvance(
  actor: FinanceActor,
  id: string,
  write = false,
  tx: DbClient = prisma,
) {
  const member = await activeMemberOrSuperAdmin(tx, actor);
  const grant = await tx.financePayrollGrant.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: actor.workspace.id,
        userId: actor.user.id,
      },
    },
  });
  const row = await tx.staffAdvance.findFirst({
    where: { workspaceId: actor.workspace.id, id },
  });
  if (
    !member ||
    !row ||
    !canReadStaffAdvance(member, grant, actor.user.id, row.userId)
  )
    throw new FinanceError("That advance is unavailable.");
  if (write) await financeAccess(actor, "PAY_MANAGE", tx);
  await auditPayView(actor, "staff_advance", id, tx);
  return row;
}

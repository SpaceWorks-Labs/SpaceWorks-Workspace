import "server-only";
import { prisma } from "@/lib/db";
import { superAdminFileMember } from "@/lib/accessMember";
import { attachmentTypeSchema } from "@/lib/finance/tools-rules";
import {
  FinanceError,
  recordAccess,
} from "@/lib/finance/tools/access";

/** Authorised route guard for finance attachments, including orphaned reserved-folder files. */
export async function mayDownloadFinanceFile(
  file: { id: string; workspaceId: string; folder: string },
  userId: string,
  viaSuperAdmin = false,
) {
  const row = await prisma.financeAttachment.findFirst({
    where: { workspaceId: file.workspaceId, fileId: file.id },
  });
  const payrollReceipt = await prisma.ledgerEntry.findFirst({
    where: {
      workspaceId: file.workspaceId,
      receiptFileId: file.id,
      privatePayroll: true,
    },
    select: { id: true },
  });
  if (row?.recordType === "STAGED" && row.uploadedById !== userId) return false;
  if (!row && !payrollReceipt) return !file.folder.startsWith("/finance-tools");
  const member = viaSuperAdmin
    ? await superAdminFileMember(file.workspaceId, userId)
    : await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: file.workspaceId } },
        include: { workspace: true, user: { select: { id: true, name: true } } },
      });
  if (!member) return false;
  const actor = {
    user: member.user,
    workspace: member.workspace,
    membership: member,
  };
  try {
    if (row)
      await recordAccess(
        actor,
        attachmentTypeSchema.parse(row.recordType),
        row.recordId,
      );
    if (payrollReceipt) await recordAccess(actor, "LEDGER", payrollReceipt.id);
    return true;
  } catch (e) {
    if (e instanceof FinanceError) return false;
    throw e;
  }
}

import "server-only";
import { superAdminFileMember } from "@/lib/accessMember";
import { prisma } from "@/lib/db";
import { deleteObjects, uploadWorkspaceFile } from "@/lib/storage";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "@/lib/finance/service";
import { FinanceError, lockFinance } from "@/lib/finance/tools/access";
import { controlRecord, type ControlsActor } from "./access";
import { recordAuditEvent } from "@/lib/audit";
export async function uploadControlFiles(
  actor: ControlsActor,
  recordId: string,
  files: File[],
) {
  await controlRecord(actor, recordId, true);
  if (
    !files.length ||
    files.length > 10 ||
    files.reduce((n, f) => n + f.size, 0) > 24 * 1024 * 1024
  )
    throw new FinanceError(
      "Choose up to ten files, 10 MB each and 24 MB altogether.",
    );
  const keys: string[] = [];
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockFinance(tx, actor.workspace.id);
        await controlRecord(actor, recordId, true, tx);
        const count = await tx.moneyControlAttachment.count({
          where: {
            workspaceId: actor.workspace.id,
            recordId,
            file: { deletedAt: null },
          },
        });
        if (count + files.length > 20)
          throw new FinanceError("Keep up to twenty proofs per record.");
        const out = [];
        for (const file of files) {
          const upload = await uploadWorkspaceFile({
            workspaceId: actor.workspace.id,
            uploadedById: actor.user.id,
            file,
            folder: "/money-controls",
            allowedTypes: RECEIPT_TYPES,
            maxBytes: RECEIPT_MAX_BYTES,
            client: tx,
          });
          if (!upload.ok) throw new FinanceError(upload.error);
          keys.push(upload.file.storageKey);
          await tx.moneyControlAttachment.create({
            data: {
              workspaceId: actor.workspace.id,
              recordId,
              fileId: upload.file.id,
            },
          });
          out.push({
            id: upload.file.id,
            filename: upload.file.filename,
            contentType: upload.file.contentType,
          });
        }
        await recordAuditEvent({
          workspaceId: actor.workspace.id,
          actorId: actor.user.id,
          action: "moneycontrols.files_attached",
          targetType: "money_control",
          targetId: recordId,
          metadata: { count: out.length },
          client: tx,
        });
        return out;
      },
      { timeout: 30_000 },
    );
  } catch (e) {
    await deleteObjects(keys).catch(() => undefined);
    throw e;
  }
}
export async function removeControlFile(actor: ControlsActor, fileId: string) {
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const attachment = await tx.moneyControlAttachment.findFirst({
      where: { workspaceId: actor.workspace.id, fileId },
    });
    if (!attachment) throw new FinanceError("That file is unavailable.");
    const row = await controlRecord(actor, attachment.recordId, true, tx);
    if (row.status !== "DRAFT")
      throw new FinanceError(
        "Confirmed evidence is retained. Add a corrected copy with a note.",
      );
    await tx.fileObject.updateMany({
      where: { workspaceId: actor.workspace.id, id: fileId },
      data: { deletedAt: new Date() },
    });
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "moneycontrols.file_removed",
      targetType: "money_control",
      targetId: row.id,
      client: tx,
    });
    return row.id;
  });
}
export async function mayDownloadControlFile(
  file: { id: string; workspaceId: string; folder: string },
  userId: string,
  viaSuperAdmin = false,
) {
  const attachment = await prisma.moneyControlAttachment.findFirst({
    where: { workspaceId: file.workspaceId, fileId: file.id },
  });
  if (!attachment) return !file.folder.startsWith("/money-controls");
  const member = viaSuperAdmin
    ? await superAdminFileMember(file.workspaceId, userId)
    : await prisma.membership.findFirst({
        where: { workspaceId: file.workspaceId, userId },
        include: { workspace: true, user: { select: { id: true, name: true } } },
      });
  if (!member) return false;
  try {
    const row = await controlRecord(
      { user: member.user, workspace: member.workspace, membership: member },
      attachment.recordId,
    );
    if (row.payroll)
      await recordAuditEvent({
        workspaceId: file.workspaceId,
        actorId: userId,
        action: "moneycontrols.payroll_file_viewed",
        targetType: "money_control",
        targetId: row.id,
      });
    return true;
  } catch (e) {
    if (e instanceof FinanceError) return false;
    throw e;
  }
}

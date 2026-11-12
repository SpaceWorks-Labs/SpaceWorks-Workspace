import "server-only";
import { canDownloadOrgFile } from "@/lib/orgPeople/files";
import { canDownloadProductFile } from "@/lib/productOps/access";
import { mayDownloadControlFile } from "@/lib/moneyControls/files";
import { caseAccess } from "@/lib/govextras/cases";
import { mayDownloadDocumentFile } from "@/lib/documents/files";
import { canDownloadOpsFile } from "@/lib/opsGaps/attachments";
import { mayDownloadFinanceFile } from "@/lib/finance/tools/files";

import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isSuperAdminEmail, superAdminMembership } from "@/lib/workspaceGate";
import { decideAccess } from "@/lib/chat/access";
import { canViewFinance, hasRoleAtLeast } from "@/lib/roles";
import { hiddenTeamIds } from "@/lib/teamAccess";
import { isApproverOf } from "@/lib/approvals/engine";

/**
 * Can `userId` download file `fileId`? Requires an ACTIVE membership in the
 * file's workspace (non-archived). Files attached to admin-only docs need
 * ADMIN; task attachments in a private team's project need that team;
 * purchase-request and reimbursement receipts are limited to the requester,
 * admins and that request's approvers; ledger receipts follow the finance
 * visibility rule; chat attachments
 * need read access to a channel the file was posted in. Returns the file
 * or null (callers answer 404 either way, so ids never reveal anything).
 */
export async function findDownloadableFile(fileId: string, userId: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(fileId)) return null;
  const file = await prisma.fileObject.findUnique({
    where: { id: fileId },
    select: {
      id: true, workspaceId: true, storageKey: true, filename: true, contentType: true, size: true, deletedAt: true, folder: true,
      governanceAttachments: { select: { record: { select: { archivedAt: true } } } },
      doc: { select: { visibility: true } },
      task: { select: { project: { select: { teamId: true } } } },
      _count: { select: { ledgerReceipts: true } },
      messageAttachments: { select: { message: { select: { channel: { select: { id: true, kind: true, teamId: true, archivedAt: true } } } } } },
      workspace: { select: { archivedAt: true, status: true, financeVisibleToMembers: true } },
    },
  });
  if (!file || file.deletedAt || file.workspace.archivedAt) return null;
  // A suspended, pending or rejected organisation serves no member downloads; only the super admin (below) still reads it.
  const row = file.workspace.status !== "ACTIVE" ? null : await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: file.workspaceId } },
    select: { role: true, status: true, user: { select: { disabledAt: true } } },
  });
  let membership: { role: WorkspaceRole; viaSuperAdmin?: boolean } | null = row && row.status === "ACTIVE" && !row.user.disabledAt ? { role: row.role } : null;
  // Not an active member: only the super admin (fresh MFA proof; audited once per 12h) gets in, silently.
  if (!membership) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, disabledAt: true } });
    if (!user || user.disabledAt || !isSuperAdminEmail(user.email)) return null;
    const workspace = await prisma.workspace.findUnique({ where: { id: file.workspaceId } });
    const synthetic = workspace && (await superAdminMembership(workspace, { id: userId, email: user.email }, true));
    if (!synthetic) return null;
    membership = { role: synthetic.role, viaSuperAdmin: true };
  }
  const viaSuperAdmin = membership.viaSuperAdmin === true;
  const { canDownloadAnalyticsFile } = await import("@/lib/analytics/files");
  if (!await canDownloadAnalyticsFile(file, userId, membership.role)) return null;
  const { canDownloadMarketingItFile } = await import("@/lib/marketingIt/files");
  if (!await canDownloadMarketingItFile(file, { user: { id: userId }, workspace: { id: file.workspaceId, slug: "", timezone: "UTC" }, membership })) return null;
  if (file.folder === "/governance" || file.folder.startsWith("/governance/") || file.governanceAttachments.length) {
    if (!hasRoleAtLeast(membership.role, "ADMIN")) return null;
  }
  if (!(await mayDownloadDocumentFile(file, userId, viaSuperAdmin))) return null;
  if (file.folder === "/funding" || file.folder.startsWith("/funding/") || await prisma.fundingAttachment.count({ where: { workspaceId: file.workspaceId, fileId: file.id } })) {
    if (!hasRoleAtLeast(membership.role, "ADMIN") || !await prisma.fundingAttachment.findFirst({ where: { workspaceId: file.workspaceId, fileId: file.id, record: { workspaceId: file.workspaceId, archivedAt: null } }, select: { id: true } })) return null;
  }
  const caseFiles = await prisma.safeguardingAttachment.findMany({where:{workspaceId:file.workspaceId,fileId:file.id},select:{caseId:true}});
  if(file.folder === "/safeguarding" || file.folder.startsWith("/safeguarding/") || caseFiles.length) {
    if(caseFiles.length !== 1) return null;
    const workspace = await prisma.workspace.findUnique({where:{id:file.workspaceId},select:{id:true,slug:true,timezone:true}});
    if(!workspace) return null;
    try {await caseAccess({user:{id:userId},workspace,membership},caseFiles[0].caseId);}
    catch {return null;}
    const { recordAuditEvent } = await import("@/lib/audit");
    await recordAuditEvent({workspaceId:file.workspaceId,actorId:userId,action:"safeguarding.file_viewed",targetType:"safeguarding",targetId:caseFiles[0].caseId});
  }
  if (!(await canDownloadOrgFile(file, userId, membership.role, viaSuperAdmin))) return null;
  if (!(await canDownloadProductFile(file, userId, membership.role, viaSuperAdmin))) return null;
  if (!(await canDownloadOpsFile(file, userId, membership.role, viaSuperAdmin))) return null;
  if (!(await mayDownloadFinanceFile(file, userId, viaSuperAdmin))) return null;
  if (!(await mayDownloadControlFile(file, userId, viaSuperAdmin))) return null;
  if (file.doc?.visibility === "ADMINS" && !hasRoleAtLeast(membership.role, "ADMIN")) return null;
  const taskTeamId = file.task?.project?.teamId;
  if (taskTeamId && (await hiddenTeamIds(file.workspaceId, { userId, role: membership.role })).includes(taskTeamId)) return null;
  const calendarRecords = await prisma.calendarEntry.findMany({ where: { workspaceId: file.workspaceId, fileIds: { has: file.id } }, select: { id: true } });
  if (file.storageKey && file.filename && calendarRecords.length > 0) {
    const { entryWhere } = await import("@/lib/calendar/access");
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: file.workspaceId } });
    const actor = { user: { id: userId, name: null }, workspace, membership };
    if (!(await prisma.calendarEntry.findFirst({ where: { AND: [await entryWhere(actor), { id: { in: calendarRecords.map(r => r.id) } }] } }))) return null;
  }
  // Unlinked calendar uploads are never downloadable through the library.
  const calendarFile = await prisma.fileObject.findFirst({ where: { id: file.id, workspaceId: file.workspaceId, folder: "/calendar" }, select: { id: true } });
  if (calendarFile && calendarRecords.length === 0) return null;
  if (!(await canReadRequestReceipt(file.id, file.workspaceId, userId, membership.role))) return null;
  if (file._count.ledgerReceipts > 0 && !canViewFinance(membership, file.workspace)) return null;
  if (!viaSuperAdmin && file.messageAttachments.length > 0 && !(await canReadAnyChannel(file.workspaceId, userId, membership.role, file.messageAttachments.map((a) => a.message.channel)))) return null;
  return file;
}

async function canReadAnyChannel(
  workspaceId: string,
  userId: string,
  role: Parameters<typeof hasRoleAtLeast>[0],
  channels: Array<{ id: string; kind: Parameters<typeof decideAccess>[0]["kind"]; teamId: string | null; archivedAt: Date | null }>,
): Promise<boolean> {
  const memberOf = new Set(
    (await prisma.channelMember.findMany({ where: { userId, channelId: { in: channels.map((c) => c.id) } }, select: { channelId: true } })).map((m) => m.channelId),
  );
  const hidden = channels.some((c) => c.teamId) ? await hiddenTeamIds(workspaceId, { userId, role }) : [];
  return channels.some((c) => decideAccess({
    kind: c.kind,
    archived: Boolean(c.archivedAt),
    isMember: memberOf.has(c.id),
    role,
    teamHidden: Boolean(c.teamId && !memberOf.has(c.id) && hidden.includes(c.teamId)),
  }).canRead);
}


async function canReadRequestReceipt(fileId: string, workspaceId: string, userId: string, role: Parameters<typeof hasRoleAtLeast>[0]): Promise<boolean> {
  const [purchases, reimbursements] = await Promise.all([
    prisma.purchaseRequest.findMany({ where: { workspaceId, fileIds: { has: fileId } }, select: { id: true, requesterId: true } }),
    prisma.reimbursement.findMany({ where: { workspaceId, receiptFileIds: { has: fileId } }, select: { id: true, claimantId: true } }),
  ]);
  if (purchases.length === 0 && reimbursements.length === 0) return true;
  if (hasRoleAtLeast(role, "ADMIN")) return true;
  if (purchases.some((p) => p.requesterId === userId) || reimbursements.some((r) => r.claimantId === userId)) return true;
  const approvals = await prisma.approvalRequest.findMany({
    where: { workspaceId, subjectId: { in: [...purchases.map((p) => p.id), ...reimbursements.map((r) => r.id)] } },
    select: { id: true, steps: true, requesterId: true, currentStep: true, workspace: { select: { id: true, slug: true, name: true, timezone: true } } },
  });
  for (const approval of approvals) {
    const actor = { user: { id: userId, name: null }, workspace: approval.workspace, membership: { role } };
    if (await isApproverOf(actor, approval)) return true;
  }
  return false;
}

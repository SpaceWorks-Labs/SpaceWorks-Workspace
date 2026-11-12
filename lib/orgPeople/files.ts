import "server-only";
import type { WorkspaceRole } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { uploadWorkspaceFile, deleteObjects } from "@/lib/storage";
import { guard, OperationsError, type OpsActor } from "@/lib/opsGaps/context";
import { attendancePeople, audit, orgWrite, unavailable } from "./service";
import { z } from "zod";
export const ORG_FILE_FOLDER = "/org-people";
export const fileKind = z.enum(["attendance", "responsibility"]);
export type OrgFileKind = z.infer<typeof fileKind>;
const types = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);
export async function canReadOrgRecord(actor: OpsActor, kind: OrgFileKind, id: string, tx: DbClient = prisma) {
  await guard(actor, false, tx);
  if (kind === "responsibility") return Boolean(await tx.responsibility.findFirst({ where: { workspaceId: actor.workspace.id, id } }));
  const people = await attendancePeople(actor, tx);
  return Boolean(await tx.attendanceEntry.findFirst({ where: { workspaceId: actor.workspace.id, id, userId: { in: people.map(p => p.userId) } } }));
}
export async function orgFiles(actor: OpsActor, kind: OrgFileKind, recordIds: string[]) {
  await guard(actor);
  for (const id of recordIds) if (!await canReadOrgRecord(actor, kind, id)) throw unavailable();
  return prisma.orgPeopleAttachment.findMany({ where: { workspaceId: actor.workspace.id, kind, recordId: { in: recordIds }, file: { deletedAt: null } }, select: { recordId: true, file: { select: { id: true, filename: true, contentType: true, size: true } } }, orderBy: { createdAt: "asc" } });
}
export async function attachOrgFiles(actor: OpsActor, kind: OrgFileKind, recordId: string, files: File[]) {
  if (!files.length || files.length > 10 || files.reduce((n, f) => n + f.size, 0) > 25 * 1024 * 1024) throw new OperationsError("Choose 1 to 10 images or PDFs totalling 25 MB or less.");
  const keys: string[] = [];
  try { return await orgWrite(actor, kind === "responsibility", async tx => {
    if (!await canReadOrgRecord(actor, kind, recordId, tx)) throw unavailable();
    if (kind === "attendance") {
      const row = await tx.attendanceEntry.findFirstOrThrow({ where: { workspaceId: actor.workspace.id, id: recordId } });
      const { canRecordAttendance } = await import("@/lib/roles");
      const target = await tx.membership.findFirstOrThrow({ where: { workspaceId: actor.workspace.id, userId: row.userId } });
      const profile = await tx.memberProfile.findFirst({ where: { workspaceId: actor.workspace.id, userId: row.userId } });
      if (!canRecordAttendance(actor.membership, row.userId === actor.user.id, profile?.managerId === actor.user.id, target.role)) throw unavailable();
    }
    if (await tx.orgPeopleAttachment.count({ where: { workspaceId: actor.workspace.id, kind, recordId } }) + files.length > 30) throw new OperationsError("Keep each record within 30 files.");
    for (const file of files) {
      const stored = await uploadWorkspaceFile({ workspaceId: actor.workspace.id, uploadedById: actor.user.id, folder: ORG_FILE_FOLDER, file, allowedTypes: types, client: tx });
      if (!stored.ok) throw new OperationsError(stored.error);
      keys.push(stored.file.storageKey);
      await tx.orgPeopleAttachment.create({ data: { workspaceId: actor.workspace.id, kind, recordId, fileId: stored.file.id } });
    }
    await audit(actor, "files", recordId, tx);
  }); } catch (error) { await deleteObjects(keys).catch(() => undefined); throw error; }
}
export async function canDownloadOrgFile(file: { id: string; workspaceId: string; folder: string }, userId: string, role: WorkspaceRole, viaSuperAdmin = false) {
  const attachment = await prisma.orgPeopleAttachment.findFirst({ where: { workspaceId: file.workspaceId, fileId: file.id } });
  if (!attachment) return file.folder !== ORG_FILE_FOLDER && !file.folder.startsWith(`${ORG_FILE_FOLDER}/`);
  const kind = fileKind.safeParse(attachment.kind); if (!kind.success) return false;
  try { return await canReadOrgRecord({ workspace: { id: file.workspaceId, slug: "", name: "", timezone: "UTC" }, user: { id: userId, name: null }, membership: { role, ...(viaSuperAdmin ? { viaSuperAdmin: true } : {}) } }, kind.data, attachment.recordId); } catch { return false; }
}

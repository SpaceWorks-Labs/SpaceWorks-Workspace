import "server-only";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { canManageProductOps, canManageProductEstimates } from "@/lib/roles";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
export type Actor = { user: { id: string; name?: string | null }; workspace: { id: string; slug: string; timezone: string }; membership: { role: WorkspaceRole; viaSuperAdmin?: boolean } };
export class ProductError extends Error {}
export const ensure: (value: unknown, message?: string) => asserts value = (value, message = "That record is unavailable. Refresh and try again.") => { if (!value) throw new ProductError(message); };
export async function currentActor(actor: Actor, tx: Tx = prisma): Promise<Actor> {
 const found = await activeMemberOrSuperAdmin(tx, actor);
 const member = found && { role: found.role, ...(found.viaSuperAdmin ? { viaSuperAdmin: true } : {}) };
 ensure(member && canManageProductOps(member), "You don't have access to do that.");
 return { ...actor, membership: member };
}
export async function lock(actor: Actor, tx: Tx) {
 await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR NO KEY UPDATE`;
 return currentActor(actor, tx);
}
export async function projectWhere(actor: Actor): Promise<Prisma.ProjectWhereInput> {
 return { workspaceId: actor.workspace.id, status: { not: "ARCHIVED" }, ...teamScopeFilter(await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role })) };
}
export async function visibleWhere(actor: Actor, tx: Tx = prisma): Promise<Prisma.ProductRecordWhereInput> {
 const projects = await tx.project.findMany({ where: await projectWhere(actor), select: { id: true } });
 return { workspaceId: actor.workspace.id, ...(canManageProductEstimates(actor.membership) ? {} : { kind: { not: "ESTIMATE" } }), OR: [{ projectId: null }, { projectId: { in: projects.map(p => p.id) } }] };
}
export async function findRecord(actor: Actor, id: string, tx: Tx = prisma, archived = false) {
 const row = await tx.productRecord.findFirst({ where: { AND: [await visibleWhere(actor, tx), { id, archivedAt: archived ? { not: null } : null }] } }); ensure(row); return row;
}
export async function canDownloadProductFile(file: { id: string; workspaceId: string; folder: string }, userId: string, role: WorkspaceRole, viaSuperAdmin = false) {
 const attachments = await prisma.productAttachment.findMany({ where: { workspaceId: file.workspaceId, fileId: file.id }, select: { recordId: true } });
 if (!attachments.length) return !(file.folder === "/product-ops" || file.folder.startsWith("/product-ops/"));
 try {
  const workspace = await prisma.workspace.findFirstOrThrow({ where: { id: file.workspaceId }, select: { id: true, slug: true, timezone: true } });
  const actor = await currentActor({ user: { id: userId }, workspace, membership: { role, ...(viaSuperAdmin ? { viaSuperAdmin: true } : {}) } });
  if (attachments.length !== 1) return false;
  await findRecord(actor, attachments[0].recordId); return true;
 } catch { return false; }
}

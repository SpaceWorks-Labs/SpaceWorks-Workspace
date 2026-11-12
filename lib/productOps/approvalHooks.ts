import "server-only";
import type { ApprovalHook } from "@/lib/approvals/types";
import { hasRoleAtLeast } from "@/lib/roles";
const readable: NonNullable<ApprovalHook["canRead"]> = async (tx, workspaceId, subjectId, userId) => {
 const member = await tx.membership.findFirst({ where: { workspaceId, userId, status: "ACTIVE", user: { disabledAt: null }, workspace: { status: "ACTIVE", archivedAt: null } }, select: { role: true } });
 if (!member || !hasRoleAtLeast(member.role, "MEMBER")) return false;
 const record = await tx.productRecord.findFirst({ where: { workspaceId, id: subjectId, kind: { in: ["RELEASE", "CHANGE"] }, archivedAt: null }, select: { projectId: true } });
 if (!record) return false;
 if (!record.projectId) return true;
 return !!await tx.project.findFirst({ where: { workspaceId, id: record.projectId, status: { not: "ARCHIVED" }, ...(hasRoleAtLeast(member.role, "ADMIN") ? {} : { OR: [{ teamId: null }, { team: { visibility: "PUBLIC" } }, { team: { members: { some: { userId } } } }] }) }, select: { id: true } });
};
export const releaseApprovalHook: ApprovalHook = { noun: "release", url: (slug, id) => `/w/${slug}/product-ops/releases?edit=${id}`, canRead: readable };
export const changeApprovalHook: ApprovalHook = { noun: "change", url: (slug, id) => `/w/${slug}/product-ops/changes?edit=${id}`, canRead: readable };

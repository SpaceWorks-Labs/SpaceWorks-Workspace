import "server-only";

import { prisma } from "@/lib/db";

export const AUDIT_PAGE_SIZE = 25;

export async function loadOrgOverview(id: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id },
    select: {
      id: true, name: true, slug: true, status: true, statusReason: true, suspendedAt: true, archivedAt: true, createdAt: true,
      limits: { select: { plan: true } },
    },
  });
  if (!workspace) return null;
  const request = await prisma.orgRequest.findFirst({
    where: { workspaceId: id, kind: "NEW_ORG" },
    orderBy: { createdAt: "asc" },
    select: {
      status: true, decidedAt: true, decisionNote: true, createdAt: true, message: true,
      requestedBy: { select: { name: true, email: true } },
      decidedBy: { select: { name: true, email: true } },
    },
  });
  const owners = await prisma.membership.findMany({
    where: { workspaceId: id, role: "OWNER", status: "ACTIVE" },
    select: { user: { select: { name: true, email: true } } },
  });
  return { workspace, request, owners: owners.map((owner) => owner.user) };
}

export async function loadOrgMembers(workspaceId: string) {
  return prisma.membership.findMany({
    where: { workspaceId },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    take: 500,
    select: { id: true, role: true, status: true, joinedAt: true, user: { select: { name: true, email: true } } },
  });
}

export async function loadOrgAudit(workspaceId: string, page: number) {
  const total = await prisma.auditEvent.count({ where: { workspaceId } });
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const events = await prisma.auditEvent.findMany({
    where: { workspaceId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (current - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE,
    select: { id: true, action: true, targetType: true, createdAt: true, actor: { select: { name: true, email: true } } },
  });
  return { events, total, page: current, pages };
}

export async function loadOrgRequests(workspaceId: string) {
  return prisma.orgRequest.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, kind: true, status: true, payload: true, message: true, decisionNote: true, createdAt: true, decidedAt: true,
      requestedBy: { select: { name: true, email: true } },
    },
  });
}

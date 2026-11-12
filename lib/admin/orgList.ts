import "server-only";

import type { Prisma, WorkspaceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ORG_STATUSES } from "@/lib/admin/filterOptions";
import { getEffectiveLimits, type Limits } from "@/lib/limits";
import { workspaceUsage, type WorkspaceUsage } from "@/lib/limits/usage";

export const ORG_PAGE_SIZE = 20;
export { ORG_STATUSES };

export type OrgListQuery = { status?: string; q?: string; page?: number };

export type OrgListRow = {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  archived: boolean;
  createdAt: Date;
  owners: Array<{ name: string | null; email: string }>;
  usage: WorkspaceUsage;
  limits: Limits;
};

function whereFor(query: OrgListQuery): Prisma.WorkspaceWhereInput {
  const where: Prisma.WorkspaceWhereInput = {};
  if (query.status && (ORG_STATUSES as readonly string[]).includes(query.status)) where.status = query.status as WorkspaceStatus;
  const q = query.q?.trim().slice(0, 100);
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
      { memberships: { some: { role: "OWNER", user: { email: { contains: q, mode: "insensitive" } } } } },
    ];
  }
  return where;
}

/** One page of organisations with owners and usage against effective limits. */
export async function listOrganisations(query: OrgListQuery): Promise<{ rows: OrgListRow[]; total: number; page: number; pages: number }> {
  const where = whereFor(query);
  const total = await prisma.workspace.count({ where });
  const pages = Math.max(1, Math.ceil(total / ORG_PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page ?? 1), pages);
  const workspaces = await prisma.workspace.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * ORG_PAGE_SIZE,
    take: ORG_PAGE_SIZE,
    select: {
      id: true, name: true, slug: true, status: true, archivedAt: true, createdAt: true,
      memberships: { where: { role: "OWNER", status: "ACTIVE" }, select: { user: { select: { name: true, email: true } } }, take: 5 },
    },
  });
  const rows = await Promise.all(
    workspaces.map(async (workspace) => {
      const [usage, limits] = await Promise.all([workspaceUsage(workspace.id), getEffectiveLimits(workspace.id)]);
      return {
        id: workspace.id, name: workspace.name, slug: workspace.slug, status: workspace.status, archived: Boolean(workspace.archivedAt), createdAt: workspace.createdAt,
        owners: workspace.memberships.map((m) => m.user), usage, limits,
      };
    }),
  );
  return { rows, total, page, pages };
}

export async function countOrganisationsByStatus(): Promise<Record<WorkspaceStatus, number>> {
  const groups = await prisma.workspace.groupBy({ by: ["status"], _count: { _all: true }, where: { archivedAt: null } });
  const out = { PENDING: 0, ACTIVE: 0, SUSPENDED: 0, REJECTED: 0 } as Record<WorkspaceStatus, number>;
  for (const group of groups) out[group.status] = group._count._all;
  return out;
}

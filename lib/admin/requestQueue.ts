import "server-only";

import type { OrgRequestKind, OrgRequestStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { REQUEST_KINDS, REQUEST_STATUSES } from "@/lib/admin/filterOptions";

export const REQUEST_PAGE_SIZE = 25;
export { REQUEST_KINDS, REQUEST_STATUSES };

export type RequestQuery = { kind?: string; status?: string; page?: number };

/** Unified queue. Pending first-in first-out; decided requests newest first. */
export async function listRequests(query: RequestQuery) {
  const status = (REQUEST_STATUSES as readonly string[]).includes(query.status ?? "") ? (query.status as OrgRequestStatus) : "PENDING";
  const where: Prisma.OrgRequestWhereInput = { status };
  if ((REQUEST_KINDS as readonly string[]).includes(query.kind ?? "")) where.kind = query.kind as OrgRequestKind;
  const total = await prisma.orgRequest.count({ where });
  const pages = Math.max(1, Math.ceil(total / REQUEST_PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page ?? 1), pages);
  const rows = await prisma.orgRequest.findMany({
    where,
    orderBy: [{ createdAt: status === "PENDING" ? "asc" : "desc" }, { id: "asc" }],
    skip: (page - 1) * REQUEST_PAGE_SIZE,
    take: REQUEST_PAGE_SIZE,
    select: {
      id: true, kind: true, status: true, requestedName: true, requestedSlug: true, payload: true, message: true, decisionNote: true, createdAt: true, decidedAt: true, workspaceId: true,
      requestedBy: { select: { name: true, email: true } },
      workspace: { select: { name: true, slug: true } },
    },
  });
  return { rows, total, page, pages, status };
}

export async function countPendingRequests(): Promise<number> {
  return prisma.orgRequest.count({ where: { status: "PENDING" } });
}

import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { OrgRequestRow } from "./types";

const SELECT = {
  id: true, kind: true, status: true, workspaceId: true, requestedName: true, requestedSlug: true, payload: true, message: true,
  decisionNote: true, decidedAt: true, createdAt: true, workspace: { select: { name: true, slug: true, status: true, archivedAt: true } },
} satisfies Prisma.OrgRequestSelect;

function toRow(row: Prisma.OrgRequestGetPayload<{ select: typeof SELECT }>): OrgRequestRow {
  const { workspace, payload, ...rest } = row;
  return {
    ...rest,
    payload: (payload ?? {}) as Record<string, unknown>,
    workspaceName: workspace?.name ?? null,
    workspaceSlug: workspace?.slug ?? null,
    workspaceOpen: Boolean(workspace && workspace.status === "ACTIVE" && !workspace.archivedAt),
  };
}

/** Everything the user asked for, newest first. */
export async function listRequestsForUser(userId: string, take = 50): Promise<OrgRequestRow[]> {
  const rows = await prisma.orgRequest.findMany({ where: { requestedById: userId }, select: SELECT, orderBy: { createdAt: "desc" }, take });
  return rows.map(toRow);
}

/** Requests tied to one workspace (limit and feature requests), newest first. */
export async function listRequestsForWorkspace(workspaceId: string, take = 50): Promise<OrgRequestRow[]> {
  const rows = await prisma.orgRequest.findMany({ where: { workspaceId }, select: SELECT, orderBy: { createdAt: "desc" }, take });
  return rows.map(toRow);
}

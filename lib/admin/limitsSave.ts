import "server-only";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { invalidateLimits } from "@/lib/limits";
import { limitsAuditMetadata, limitsInputToRow, type OrgLimitsInput } from "@/lib/admin/limitFields";

/** Upsert the workspace's override row, drop the cache, audit numbers only. Returns false when the workspace is missing. */
export async function saveOrgLimits(input: OrgLimitsInput, actorId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { id: true } });
  if (!workspace) return false;
  const row = limitsInputToRow(input);
  await prisma.$transaction(async (tx) => {
    const before = await tx.workspaceLimits.findUnique({ where: { workspaceId: workspace.id } });
    await tx.workspaceLimits.upsert({
      where: { workspaceId: workspace.id },
      create: { workspaceId: workspace.id, ...row, updatedById: actorId },
      update: { ...row, updatedById: actorId },
    });
    await recordAuditEvent({
      client: tx, action: "admin.workspace_limits_updated", workspaceId: workspace.id, actorId,
      targetType: "Workspace", targetId: workspace.id, metadata: limitsAuditMetadata(before, row),
    });
  });
  invalidateLimits(workspace.id);
  return true;
}

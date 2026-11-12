import "server-only";

import type { Workspace } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getWorkspaceModules } from "@/lib/limits/modules";
import type { NavContext } from "@/lib/nav";
import { canViewPayroll } from "@/lib/roles";
import type { WorkspaceMembership } from "@/lib/workspaceGate";

/**
 * The one place that turns a resolved membership into a NavContext, so the
 * sidebar, the settings tabs and the command palette all show the same
 * areas the page guards admit: role, module switches (and sub-areas),
 * organisation status and the payroll grant (`canViewPayroll`).
 */
export async function navContextFor(workspace: Workspace, membership: WorkspaceMembership): Promise<NavContext> {
  const [enabledModules, grant] = await Promise.all([
    getWorkspaceModules(workspace.id),
    prisma.financePayrollGrant.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: membership.userId } },
      select: { manage: true },
    }),
  ]);
  return {
    role: membership.role,
    workspace: { financeVisibleToMembers: workspace.financeVisibleToMembers, status: workspace.status },
    enabledModules,
    payrollAccess: canViewPayroll(membership, grant),
  };
}

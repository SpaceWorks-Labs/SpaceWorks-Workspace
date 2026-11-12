import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import {
  canViewAnalytics,
  canManageAnalytics,
  canViewFinance,
  canViewPayroll,
} from "@/lib/roles";
import type { WorkspaceRole, Workspace } from "@prisma/client";
export type Actor = {
  user: { id: string };
  workspace: { id: string; slug: string; timezone: string };
  membership: { role: WorkspaceRole; viaSuperAdmin?: boolean };
};
export class AnalyticsError extends Error {}
export type Access = {
  userId: string;
  workspace: Pick<
    Workspace,
    "id" | "slug" | "name" | "currency" | "timezone" | "financeVisibleToMembers"
  >;
  role: WorkspaceRole;
  admin: boolean;
  finance: boolean;
  payroll: boolean;
};
export async function analyticsAccess(
  actor: Actor,
  client: DbClient = prisma,
): Promise<Access> {
  const found = await activeMemberOrSuperAdmin(client, actor);
  const member = found && {
    role: found.role,
    workspace: {
      id: found.workspace.id,
      slug: found.workspace.slug,
      name: found.workspace.name,
      currency: found.workspace.currency,
      timezone: found.workspace.timezone,
      financeVisibleToMembers: found.workspace.financeVisibleToMembers,
    },
  };
  if (!member || !canViewAnalytics(member))
    throw new AnalyticsError(
      "That report is unavailable. Refresh and try again.",
    );
  const grant = await client.financePayrollGrant.findFirst({
    where: { workspaceId: member.workspace.id, userId: actor.user.id },
    select: { manage: true },
  });
  return {
    userId: actor.user.id,
    workspace: member.workspace,
    role: member.role,
    admin: canManageAnalytics(member),
    finance: canViewFinance(member, member.workspace),
    payroll: canViewPayroll(member, grant),
  };
}

import "server-only";

import type { Membership, Workspace, WorkspaceRole } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";

/**
 * The actor shape the per-area access helpers receive. `viaSuperAdmin` is only
 * ever set by the central guard (`requireWorkspace` / `getWorkspaceForAction`,
 * after the super-admin email and fresh MFA proof checks); never copy it from
 * client input.
 */
export type AccessActor = {
  user: { id: string };
  workspace: { id: string };
  membership?: { role: WorkspaceRole; viaSuperAdmin?: boolean };
};

export type AccessMember = Membership & { workspace: Workspace; viaSuperAdmin?: boolean };

/**
 * Re-read the actor's live membership for authorization (so stale UI and
 * internal callers cannot keep revoked access). The super admin has full
 * silent access to every workspace without a Membership row: when the actor
 * carries the central guard's synthetic membership, return an OWNER-equivalent
 * result (the workspace must still exist and not be archived) instead of
 * reading the table. Returns null when access must be refused.
 */
export async function activeMemberOrSuperAdmin(client: DbClient, actor: AccessActor): Promise<AccessMember | null> {
  if (actor.membership?.viaSuperAdmin === true) {
    const workspace = await client.workspace.findFirst({ where: { id: actor.workspace.id, status: "ACTIVE", archivedAt: null } });
    if (!workspace) return null;
    const now = new Date();
    return { id: "", userId: actor.user.id, workspaceId: workspace.id, role: "OWNER", title: null, status: "ACTIVE", joinedAt: now, updatedAt: now, workspace, viaSuperAdmin: true };
  }
  return client.membership.findFirst({
    where: { workspaceId: actor.workspace.id, userId: actor.user.id, status: "ACTIVE", user: { disabledAt: null }, workspace: { status: "ACTIVE", archivedAt: null } },
    include: { workspace: true },
  });
}

/**
 * Membership-shaped (with `workspace` and `user` included) OWNER-equivalent
 * synthetic member for the per-area download helpers, once the files lookup
 * has established super-admin silent access.
 */
export async function superAdminFileMember(workspaceId: string, userId: string) {
  const [workspace, user] = await Promise.all([
    prisma.workspace.findFirst({ where: { id: workspaceId, status: "ACTIVE", archivedAt: null } }),
    prisma.user.findFirst({ where: { id: userId, disabledAt: null }, select: { id: true, name: true } }),
  ]);
  if (!workspace || !user) return null;
  const now = new Date();
  return { id: "", userId, workspaceId, role: "OWNER" as const, title: null, status: "ACTIVE" as const, joinedAt: now, updatedAt: now, viaSuperAdmin: true as const, user, workspace };
}

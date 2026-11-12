import "server-only";

import type { MembershipStatus, WorkspaceRole } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { LAST_OWNER_ERROR } from "@/lib/membership";

type Result = { ok: true } | { ok: false; error: string };
const NOT_FOUND = "That member wasn't found.";

/** Lock the owner rows and report whether another active owner remains. Serialises concurrent owner changes. */
async function hasAnotherActiveOwner(tx: Tx, workspaceId: string, excludingId: string) {
  const owners = await tx.$queryRaw<Array<{ id: string; status: MembershipStatus }>>`
    SELECT "id", "status" FROM "Membership"
    WHERE "workspaceId" = ${workspaceId} AND "role" = 'OWNER'
    ORDER BY "id"
    FOR UPDATE
  `;
  return owners.some((owner) => owner.id !== excludingId && owner.status === "ACTIVE");
}

/** Suspend an ACTIVE organisation with a reason; members lose access until it is reactivated. */
export async function suspendOrganisation(input: { workspaceId: string; actorId: string; reason: string }): Promise<Result> {
  const updated = await prisma.workspace.updateMany({
    where: { id: input.workspaceId, status: "ACTIVE" },
    data: { status: "SUSPENDED", statusReason: input.reason, suspendedAt: new Date() },
  });
  if (updated.count !== 1) return { ok: false, error: "Only an active organisation can be suspended." };
  await recordAuditEvent({ action: "admin.workspace_suspended", workspaceId: input.workspaceId, actorId: input.actorId, targetType: "Workspace", targetId: input.workspaceId });
  return { ok: true };
}

export async function reactivateOrganisation(input: { workspaceId: string; actorId: string }): Promise<Result> {
  const updated = await prisma.workspace.updateMany({
    where: { id: input.workspaceId, status: "SUSPENDED" },
    data: { status: "ACTIVE", statusReason: null, suspendedAt: null },
  });
  if (updated.count !== 1) return { ok: false, error: "Only a suspended organisation can be reactivated." };
  await recordAuditEvent({ action: "admin.workspace_reactivated", workspaceId: input.workspaceId, actorId: input.actorId, targetType: "Workspace", targetId: input.workspaceId });
  return { ok: true };
}

/** Make an active member the owner. With `demoteOthers`, every other owner becomes an admin. */
export async function transferOwnership(input: { workspaceId: string; actorId: string; membershipId: string; demoteOthers: boolean }): Promise<Result> {
  return prisma.$transaction(async (tx) => {
    const owners = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Membership" WHERE "workspaceId" = ${input.workspaceId} AND "role" = 'OWNER' ORDER BY "id" FOR UPDATE
    `;
    const target = await tx.membership.findFirst({ where: { id: input.membershipId, workspaceId: input.workspaceId } });
    if (!target) return { ok: false as const, error: NOT_FOUND };
    if (target.status !== "ACTIVE") return { ok: false as const, error: "Choose an active member. Reactivate this one first." };
    const others = owners.filter((owner) => owner.id !== target.id).map((owner) => owner.id);
    await tx.membership.update({ where: { id: target.id }, data: { role: "OWNER" } });
    if (input.demoteOthers && others.length > 0) {
      await tx.membership.updateMany({ where: { id: { in: others }, workspaceId: input.workspaceId }, data: { role: "ADMIN" } });
    }
    await recordAuditEvent({
      client: tx, action: "admin.ownership_transferred", workspaceId: input.workspaceId, actorId: input.actorId,
      targetType: "Membership", targetId: target.id, metadata: { from: target.role, demotedOwners: input.demoteOthers ? others.length : 0 },
    });
    return { ok: true as const };
  });
}

export async function adminChangeRole(input: { workspaceId: string; actorId: string; membershipId: string; role: WorkspaceRole }): Promise<Result> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.membership.findFirst({ where: { id: input.membershipId, workspaceId: input.workspaceId } });
    if (!target) return { ok: false as const, error: NOT_FOUND };
    if (target.role === input.role) return { ok: true as const };
    if (target.role === "OWNER" && !(await hasAnotherActiveOwner(tx, input.workspaceId, target.id))) return { ok: false as const, error: LAST_OWNER_ERROR };
    await tx.membership.update({ where: { id: target.id }, data: { role: input.role } });
    await recordAuditEvent({ client: tx, action: "admin.member_role_changed", workspaceId: input.workspaceId, actorId: input.actorId, targetType: "Membership", targetId: target.id, metadata: { from: target.role, to: input.role } });
    return { ok: true as const };
  });
}

export async function adminSetStatus(input: { workspaceId: string; actorId: string; membershipId: string; status: MembershipStatus }): Promise<Result> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.membership.findFirst({ where: { id: input.membershipId, workspaceId: input.workspaceId } });
    if (!target) return { ok: false as const, error: NOT_FOUND };
    if (target.status === input.status) return { ok: true as const };
    if (input.status === "SUSPENDED" && target.role === "OWNER" && !(await hasAnotherActiveOwner(tx, input.workspaceId, target.id))) return { ok: false as const, error: LAST_OWNER_ERROR };
    await tx.membership.update({ where: { id: target.id }, data: { status: input.status } });
    await recordAuditEvent({ client: tx, action: input.status === "SUSPENDED" ? "admin.member_suspended" : "admin.member_reactivated", workspaceId: input.workspaceId, actorId: input.actorId, targetType: "Membership", targetId: target.id });
    return { ok: true as const };
  });
}

export async function adminRemoveMember(input: { workspaceId: string; actorId: string; membershipId: string }): Promise<Result> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.membership.findFirst({ where: { id: input.membershipId, workspaceId: input.workspaceId } });
    if (!target) return { ok: false as const, error: NOT_FOUND };
    if (target.role === "OWNER" && !(await hasAnotherActiveOwner(tx, input.workspaceId, target.id))) return { ok: false as const, error: LAST_OWNER_ERROR };
    await tx.channelMember.deleteMany({ where: { userId: target.userId, channel: { workspaceId: input.workspaceId } } });
    await tx.membership.delete({ where: { id: target.id } });
    await recordAuditEvent({ client: tx, action: "admin.member_removed", workspaceId: input.workspaceId, actorId: input.actorId, targetType: "Membership", targetId: target.id, metadata: { role: target.role } });
    return { ok: true as const };
  });
}

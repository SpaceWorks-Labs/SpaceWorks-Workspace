import "server-only";

import type { Membership, MembershipStatus, WorkspaceRole } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { assignableRoles, canActOnMember } from "@/lib/roles";
import { assertSeatAvailable, lockWorkspace } from "@/lib/seatLimits";

type Result = { ok: true } | { ok: false; error: string };

export const LAST_OWNER_ERROR = "A workspace needs at least one active owner. Make someone else an owner first.";

/**
 * Lock the workspace's owner rows and report whether another active owner
 * remains besides `excludingMembershipId`. Row locks serialise concurrent
 * demotions/removals so two owners cannot remove each other at once.
 */
async function hasAnotherActiveOwner(tx: Tx, workspaceId: string, excludingMembershipId: string) {
  const owners = await tx.$queryRaw<Array<{ id: string; status: MembershipStatus }>>`
    SELECT "id", "status" FROM "Membership"
    WHERE "workspaceId" = ${workspaceId} AND "role" = 'OWNER'
    ORDER BY "id"
    FOR UPDATE
  `;
  return owners.some((owner) => owner.id !== excludingMembershipId && owner.status === "ACTIVE");
}

async function loadTarget(tx: Tx, workspaceId: string, membershipId: string) {
  return tx.membership.findFirst({ where: { id: membershipId, workspaceId } });
}

/** Change a member's role. `actor` is the caller's own membership (already resolved server-side). */
export async function changeMemberRole(input: { actor: Membership; membershipId: string; role: WorkspaceRole }): Promise<Result> {
  const { actor } = input;
  if (!assignableRoles(actor).includes(input.role)) return { ok: false, error: "You can't give that role." };
  return prisma.$transaction(async (tx) => {
    const target = await loadTarget(tx, actor.workspaceId, input.membershipId);
    if (!target) return { ok: false as const, error: "That member wasn't found." };
    if (!canActOnMember(actor, target.role)) return { ok: false as const, error: "You can't change this member's role." };
    if (target.role === input.role) return { ok: true as const };
    if (target.role === "OWNER" && !(await hasAnotherActiveOwner(tx, actor.workspaceId, target.id))) {
      return { ok: false as const, error: LAST_OWNER_ERROR };
    }
    if (target.status === "ACTIVE" && (target.role === "GUEST") !== (input.role === "GUEST")) {
      await lockWorkspace(tx, actor.workspaceId);
      const seat = await assertSeatAvailable(tx, actor.workspaceId, input.role);
      if (!seat.ok) return { ok: false as const, error: seat.error };
    }
    await tx.membership.update({ where: { id: target.id }, data: { role: input.role } });
    await recordAuditEvent({
      client: tx,
      action: "member.role_changed",
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      targetType: "Membership",
      targetId: target.id,
      metadata: { from: target.role, to: input.role },
    });
    return { ok: true as const };
  });
}

/** Suspend or reactivate a member. Suspended members lose access immediately. */
export async function setMemberStatus(input: { actor: Membership; membershipId: string; status: MembershipStatus }): Promise<Result> {
  const { actor } = input;
  return prisma.$transaction(async (tx) => {
    const target = await loadTarget(tx, actor.workspaceId, input.membershipId);
    if (!target) return { ok: false as const, error: "That member wasn't found." };
    if (target.id === actor.id) return { ok: false as const, error: "You can't suspend yourself." };
    if (!canActOnMember(actor, target.role)) return { ok: false as const, error: "You can't change this member." };
    if (target.status === input.status) return { ok: true as const };
    if (input.status === "SUSPENDED" && target.role === "OWNER" && !(await hasAnotherActiveOwner(tx, actor.workspaceId, target.id))) {
      return { ok: false as const, error: LAST_OWNER_ERROR };
    }
    if (input.status === "ACTIVE" && target.status !== "ACTIVE") {
      await lockWorkspace(tx, actor.workspaceId);
      const seat = await assertSeatAvailable(tx, actor.workspaceId, target.role);
      if (!seat.ok) return { ok: false as const, error: seat.error };
    }
    await tx.membership.update({ where: { id: target.id }, data: { status: input.status } });
    await recordAuditEvent({
      client: tx,
      action: input.status === "SUSPENDED" ? "member.suspended" : "member.reactivated",
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      targetType: "Membership",
      targetId: target.id,
    });
    return { ok: true as const };
  });
}

/** Remove a member (or leave, when `membershipId` is the actor's own). */
export async function removeMember(input: { actor: Membership; membershipId: string }): Promise<Result> {
  const { actor } = input;
  return prisma.$transaction(async (tx) => {
    const target = await loadTarget(tx, actor.workspaceId, input.membershipId);
    if (!target) return { ok: false as const, error: "That member wasn't found." };
    const leaving = target.id === actor.id;
    if (!leaving && !canActOnMember(actor, target.role)) return { ok: false as const, error: "You can't remove this member." };
    if (target.role === "OWNER" && !(await hasAnotherActiveOwner(tx, actor.workspaceId, target.id))) {
      return { ok: false as const, error: LAST_OWNER_ERROR };
    }
    await tx.channelMember.deleteMany({ where: { userId: target.userId, channel: { workspaceId: actor.workspaceId } } });
    await tx.membership.delete({ where: { id: target.id } });
    await recordAuditEvent({
      client: tx,
      action: leaving ? "member.left" : "member.removed",
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      targetType: "Membership",
      targetId: target.id,
      metadata: { role: target.role },
    });
    return { ok: true as const };
  });
}

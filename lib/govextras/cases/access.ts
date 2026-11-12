import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { canContribute, canHandleSafeguarding } from "@/lib/roles";
import { GovernanceError, type Actor } from "@/lib/governance/service";
import { dayInZone } from "@/lib/governance/schemas";

export async function liveCaseMember(actor: Actor, tx: Tx = prisma) {
  const member = await activeMemberOrSuperAdmin(tx, actor);
  if (!member || !canContribute(member))
    throw new GovernanceError("You don't have access to do that.");
  return member;
}
export async function caseLock(actor: Actor, tx: Tx) {
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR NO KEY UPDATE`;
  return liveCaseMember(actor, tx);
}
export function activeHandlerWhere(
  workspaceId: string,
  timezone: string,
  now = new Date(),
) {
  return {
    workspaceId,
    revokedAt: null,
    endsOn: { gte: new Date(dayInZone(now, timezone)) },
  };
}
export async function activeHandlers(
  actor: Actor,
  tx: Tx = prisma,
  now = new Date(),
) {
  const [grants, members, committees] = await Promise.all([
    tx.safeguardingHandler.findMany({
      where: activeHandlerWhere(
        actor.workspace.id,
        actor.workspace.timezone,
        now,
      ),
    }),
    tx.membership.findMany({
      where: {
        workspaceId: actor.workspace.id,
        status: "ACTIVE",
        role: { in: ["MEMBER", "ADMIN", "OWNER"] },
        user: { disabledAt: null },
      },
      select: { userId: true },
    }),
    tx.governanceRecord.findMany({
      where: {
        workspaceId: actor.workspace.id,
        kind: "COMMITTEE",
        status: "ACTIVE",
        archivedAt: null,
      },
      select: { id: true },
    }),
  ]);
  return grants.filter(
    (g) =>
      members.some((m) => m.userId === g.userId) &&
      committees.some((c) => c.id === g.committeeId),
  );
}
export async function caseAccess(
  actor: Actor,
  caseId: string,
  tx: Tx = prisma,
) {
  const member = await liveCaseMember(actor, tx);
  const row = await tx.safeguardingCase.findFirst({
    where: { workspaceId: actor.workspace.id, id: caseId },
  });
  const grants = await activeHandlers(actor, tx);
  if (
    !row ||
    !canHandleSafeguarding(
      member,
      grants.some((g) => g.userId === actor.user.id),
      row.handlerIds.includes(actor.user.id),
    )
  )
    throw new GovernanceError(
      "That case is unavailable. Contact its designated handler.",
    );
  return row;
}

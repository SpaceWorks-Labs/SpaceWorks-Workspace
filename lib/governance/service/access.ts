import "server-only";
import type { WorkspaceRole } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { canManageGovernance } from "@/lib/roles";

export type Actor = {
  user: { id: string };
  workspace: { id: string; slug: string; timezone: string };
  membership: { role: WorkspaceRole; viaSuperAdmin?: boolean };
};
export class GovernanceError extends Error {}
export const ensure: (condition: unknown, message?: string) => asserts condition = (
  condition,
  message = "That record is unavailable. Refresh and try again.",
) => {
  if (!condition) throw new GovernanceError(message);
};
/** Recheck current authority inside each transaction, including stale actors. */
export async function assertActor(actor: Actor, tx: Tx = prisma) {
  const m = await activeMemberOrSuperAdmin(tx, actor);
  ensure(m && canManageGovernance(m), "You don't have access to do that.");
}
export async function lock(actor: Actor, tx: Tx) {
  // One short workspace lock serialises record edits, approvals and recurrence/checklist retries.
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR NO KEY UPDATE`;
  await assertActor(actor, tx);
}

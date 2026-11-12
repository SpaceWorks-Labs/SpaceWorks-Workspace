import "server-only";
import { type WorkspaceRole } from "@prisma/client";
import {
  prisma,
  type Tx,
} from "@/lib/db";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { canManageFunding } from "@/lib/roles";

export type Actor = {
  user: { id: string };
  workspace: { id: string; slug: string; timezone: string };
  membership: { role: WorkspaceRole; viaSuperAdmin?: boolean };
};
export class FundingError extends Error {}
export const ensure: (value: unknown, message?: string) => asserts value = (
  value,
  message = "That record is unavailable. Refresh and try again.",
) => {
  if (!value) throw new FundingError(message);
};
export async function assertActor(actor: Actor, tx: Tx = prisma) {
  const member = await activeMemberOrSuperAdmin(tx, actor);
  ensure(
    member && canManageFunding(member),
    "You don't have access to do that.",
  );
}
export async function lock(actor: Actor, tx: Tx) {
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR NO KEY UPDATE`;
  await assertActor(actor, tx);
}

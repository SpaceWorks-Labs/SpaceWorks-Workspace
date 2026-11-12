import "server-only";

import type { WorkspaceRole } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { assertWithinLimit, type LimitResult } from "@/lib/limits/enforce";

/**
 * Seat limits (members and guests) for callers that add or re-activate a seat
 * inside a transaction. Pending invitations hold a seat of their role class, so
 * a workspace cannot invite past its cap. The workspace row lock serialises
 * racing callers on the last slot.
 */

export async function lockWorkspace(tx: Tx, workspaceId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
}

/**
 * Would one more seat of `role` fit? Pending invitations count as taken seats,
 * except `email` (replaced by this action). `consume: true` is for
 * accepting an invitation: it already holds its seat, so only real members count.
 */
export async function assertSeatAvailable(
  tx: Tx,
  workspaceId: string,
  role: WorkspaceRole,
  exclude: { consume?: boolean; email?: string } = {},
): Promise<LimitResult> {
  const guest = role === "GUEST";
  const pending = exclude.consume ? 0 : await tx.invitation.count({
    where: {
      workspaceId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      role: guest ? "GUEST" : { not: "GUEST" },
      ...(exclude.email ? { email: { not: exclude.email } } : {}),
    },
  });
  return assertWithinLimit(guest ? "guests" : "members", workspaceId, 1 + pending, tx);
}

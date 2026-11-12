import "server-only";

import type { Prisma, WorkspaceRole } from "@prisma/client";
import { hasRoleAtLeast } from "@/lib/roles";

/**
 * Who is acting, resolved server-side. A `WorkspaceContext` from
 * `requireWorkspace` / `getWorkspaceForAction` fits, and so does the
 * `TaskActor` / `CommunityActor` shape other areas use. Every ops-money
 * service (approvals, requests, vault, assets, catalogue, subscriptions,
 * forms) takes one and checks capabilities itself, so the rules hold for
 * Server Actions, route handlers and tests alike.
 */
export type OpsActor = {
  user: { id: string; name: string | null };
  workspace: { id: string; slug: string; name: string; timezone: string; currency?: string; costsVisibleToMembers?: boolean; financeVisibleToMembers?: boolean };
  membership: { role: WorkspaceRole; viaSuperAdmin?: boolean };
};

export const isAdmin = (actor: { membership: { role: WorkspaceRole } }) => hasRoleAtLeast(actor.membership.role, "ADMIN");

export function displayName(name: string | null | undefined) {
  return name?.trim() || "Someone";
}

/** Serialise work per key inside a transaction; false when another worker holds it. */
export async function tryTransactionLock(tx: Prisma.TransactionClient, key: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS "locked"`;
  return rows[0]?.locked === true;
}

/** Ids of ACTIVE members at or above `minRole`. */
export async function memberIdsAtLeast(client: Prisma.TransactionClient | import("@prisma/client").PrismaClient, workspaceId: string, minRole: WorkspaceRole): Promise<string[]> {
  const rows = await client.membership.findMany({ where: { workspaceId, status: "ACTIVE", user: { disabledAt: null } }, select: { userId: true, role: true }, take: 2000 });
  return rows.filter((row) => hasRoleAtLeast(row.role, minRole)).map((row) => row.userId);
}

/** Has a dedupe-keyed event already been recorded (scheduler idempotency, like community)? */
export async function eventAlreadySent(client: Prisma.TransactionClient, workspaceId: string, dedupeKey: string): Promise<boolean> {
  const existing = await client.notificationEventRecord.findFirst({ where: { workspaceId, dedupeKey }, select: { id: true } });
  return Boolean(existing);
}

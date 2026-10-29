import "server-only";

import type { Prisma, WorkspaceRole } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { isWorkspaceRole } from "@/lib/roles";

/**
 * Resolve a destination's people selector ({ userIds, roles, teamIds }) to
 * ACTIVE members of the workspace. Used by IN_APP_USERS and role/team EMAIL
 * destinations. Unknown or removed people are silently dropped.
 */
export type PeopleSelector = { userIds?: string[]; roles?: WorkspaceRole[]; teamIds?: string[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function staticDestinationEmails(config: Prisma.JsonValue): string[] {
  const to = config && typeof config === "object" && !Array.isArray(config) ? config.to : null;
  return Array.isArray(to) ? to.filter((value): value is string => typeof value === "string" && EMAIL.test(value) && value.length <= 320) : [];
}

/** Current explicit addresses and active selector members share one email policy. */
export async function resolveDestinationEmails(workspaceId: string, config: Prisma.JsonValue, client: DbClient = prisma): Promise<string[]> {
  const members = await resolveSelectorMembers(workspaceId, parsePeopleSelector(config), client);
  return [...new Set([...staticDestinationEmails(config), ...members.map((member) => member.user.email)].map((email) => email.toLowerCase()))].slice(0, 200);
}

/** SMTP checks only its recipient, rather than expanding an entire fanout again. */
export async function mayReceiveDestinationEmail(workspaceId: string, config: Prisma.JsonValue, email: string, client: DbClient = prisma): Promise<boolean> {
  const normalized = email.toLowerCase();
  if (staticDestinationEmails(config).some((address) => address.toLowerCase() === normalized)) return true;
  const where = selectorMemberWhere(workspaceId, parsePeopleSelector(config));
  if (!where) return false;
  return Boolean(await client.membership.findFirst({
    where: { AND: [where, { user: { email: { equals: normalized, mode: "insensitive" } } }] },
    select: { userId: true },
  }));
}

export function parsePeopleSelector(config: Prisma.JsonValue): PeopleSelector {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const raw = config as Record<string, unknown>;
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 500) : undefined);
  return { userIds: strings(raw.userIds), roles: strings(raw.roles)?.filter(isWorkspaceRole), teamIds: strings(raw.teamIds) };
}

function selectorMemberWhere(workspaceId: string, selector: PeopleSelector): Prisma.MembershipWhereInput | null {
  const or: Prisma.MembershipWhereInput[] = [];
  if (selector.userIds?.length) or.push({ userId: { in: selector.userIds } });
  if (selector.roles?.length) or.push({ role: { in: selector.roles } });
  if (selector.teamIds?.length) or.push({ user: { teamMemberships: { some: { teamId: { in: selector.teamIds }, team: { workspaceId } } } } });
  if (or.length === 0) return null;
  return { workspaceId, status: "ACTIVE", user: { disabledAt: null }, workspace: { archivedAt: null }, OR: or };
}

export async function resolveSelectorMembers(workspaceId: string, selector: PeopleSelector, client: DbClient = prisma) {
  const where = selectorMemberWhere(workspaceId, selector);
  if (!where) return [];
  return client.membership.findMany({
    where,
    select: { userId: true, role: true, user: { select: { email: true, name: true } } },
  });
}

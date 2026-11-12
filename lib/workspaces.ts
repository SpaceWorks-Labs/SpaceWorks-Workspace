import "server-only";

import type { WorkspaceRole, WorkspaceStatus } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { DEFAULT_BOARD_COLUMNS, DEFAULT_CHANNELS, DEFAULT_FINANCE_CATEGORIES, DEFAULT_LABELS } from "@/lib/workspaceDefaults";

export { DEFAULT_BOARD_COLUMNS, DEFAULT_CHANNELS, DEFAULT_LABELS } from "@/lib/workspaceDefaults";

export type CreateWorkspaceInput = {
  name: string;
  slug: string;
  ownerId: string;
  tagline?: string | null;
  timezone?: string;
  currency?: string;
};

/**
 * Create a workspace with its owner membership, default channels (#general,
 * #announcements, #random), starter labels and finance categories. Run inside
 * a transaction.
 */
export async function createWorkspaceWithDefaults(tx: DbClient, input: CreateWorkspaceInput) {
  const workspace = await tx.workspace.create({
    data: {
      name: input.name,
      slug: input.slug,
      tagline: input.tagline ?? null,
      ...(input.timezone ? { timezone: input.timezone } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      memberships: { create: { userId: input.ownerId, role: "OWNER" } },
    },
  });
  for (const channel of DEFAULT_CHANNELS) {
    await tx.channel.create({
      data: {
        workspaceId: workspace.id,
        slug: channel.slug,
        name: channel.name,
        topic: channel.topic,
        kind: "PUBLIC",
        isDefault: true,
        createdById: input.ownerId,
        members: { create: { userId: input.ownerId } },
      },
    });
  }
  await tx.label.createMany({ data: DEFAULT_LABELS.map((label) => ({ workspaceId: workspace.id, ...label })) });
  await tx.financeCategory.createMany({ data: DEFAULT_FINANCE_CATEGORIES.map((category) => ({ workspaceId: workspace.id, ...category })) });
  return workspace;
}

/** Board columns for a new project (the project phase calls this when creating one). */
export async function createDefaultBoardColumns(tx: DbClient, projectId: string) {
  await tx.boardColumn.createMany({
    data: DEFAULT_BOARD_COLUMNS.map((column, position) => ({ projectId, name: column.name, category: column.category, position })),
  });
}

/** Join a member to every default, non-archived channel of a workspace (idempotent). */
export async function joinDefaultChannels(tx: DbClient, workspaceId: string, userId: string) {
  const channels = await tx.channel.findMany({ where: { workspaceId, isDefault: true, archivedAt: null }, select: { id: true } });
  if (channels.length === 0) return;
  await tx.channelMember.createMany({ data: channels.map((channel) => ({ channelId: channel.id, userId })), skipDuplicates: true });
}

export type UserWorkspace = { id: string; slug: string; name: string; role: WorkspaceRole; status: WorkspaceStatus };

/**
 * Workspaces a user can open, alphabetically: ACTIVE and not archived. With
 * `includeSuspended`, also SUSPENDED ones where the user is an owner or admin,
 * who can still reach Settings and Plan & limits.
 */
export async function listUserWorkspaces(userId: string, options: { includeSuspended?: boolean } = {}): Promise<UserWorkspace[]> {
  const memberships = await prisma.membership.findMany({
    where: {
      userId,
      status: "ACTIVE",
      workspace: { archivedAt: null },
      OR: [
        { workspace: { status: "ACTIVE" } },
        ...(options.includeSuspended ? [{ workspace: { status: "SUSPENDED" as const }, role: { in: ["OWNER", "ADMIN"] as WorkspaceRole[] } }] : []),
      ],
    },
    select: { role: true, workspace: { select: { id: true, slug: true, name: true, status: true } } },
    orderBy: { workspace: { name: "asc" } },
    take: 100,
  });
  return memberships.map((m) => ({ ...m.workspace, role: m.role }));
}

import "server-only";

import type { Prisma, WorkspaceRole } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";
import { hiddenTeamIds } from "@/lib/teamAccess";
import type { TaskSource } from "@/lib/tasks/capabilities";

/**
 * Who may see and change projects and tasks.
 *
 * - Visibility: workspace-wide projects are visible to every member;
 *   projects of a PRIVATE team only to its members and admins
 *   (lib/teamAccess). Tasks follow their project. Tasks without a project
 *   (meeting action items, personal tasks) are visible to members, and to
 *   guests only when they created or were assigned them.
 * - GUEST: read and comment. MEMBER: create and edit tasks, create
 *   projects. ADMIN or the project owner: edit the project, its columns,
 *   archive it.
 */

export type TaskActor = {
  user: { id: string; name: string | null };
  workspace: { id: string; slug: string; name: string; timezone: string };
  membership: { role: WorkspaceRole; viaSuperAdmin?: boolean };
  /** Where the change came from (history provenance); web when absent. */
  via?: { source: TaskSource; client?: string };
};

export const canEditTasks = (actor: TaskActor) => canContribute(actor.membership);

export function canManageProject(actor: TaskActor, project: { ownerId: string | null }): boolean {
  if (hasRoleAtLeast(actor.membership.role, "ADMIN")) return true;
  return canContribute(actor.membership) && project.ownerId === actor.user.id;
}

async function hidden(actor: TaskActor, client: DbClient) {
  return hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role }, client);
}

/** `where` for projects the actor may see (always tenant-filtered). */
export async function visibleProjectWhere(actor: TaskActor, client: DbClient = prisma): Promise<Prisma.ProjectWhereInput> {
  const hiddenIds = await hidden(actor, client);
  return hiddenIds.length === 0
    ? { workspaceId: actor.workspace.id }
    : { workspaceId: actor.workspace.id, OR: [{ teamId: null }, { teamId: { notIn: hiddenIds } }] };
}

/** `where` for tasks the actor may see (always tenant-filtered). */
export async function visibleTaskWhere(actor: TaskActor, client: DbClient = prisma): Promise<Prisma.TaskWhereInput> {
  const hiddenIds = await hidden(actor, client);
  const inProject: Prisma.TaskWhereInput =
    hiddenIds.length === 0 ? { projectId: { not: null } } : { project: { OR: [{ teamId: null }, { teamId: { notIn: hiddenIds } }] } };
  const loose: Prisma.TaskWhereInput = canContribute(actor.membership)
    ? { projectId: null }
    : { projectId: null, OR: [{ creatorId: actor.user.id }, { assignees: { some: { userId: actor.user.id } } }] };
  return { workspaceId: actor.workspace.id, OR: [inProject, loose] };
}

/** Active members (MEMBER and up) who can be assigned or mentioned on a project's tasks. */
export async function assignableMembers(workspaceId: string, project: { teamId: string | null } | null, client: DbClient = prisma) {
  const memberships = await client.membership.findMany({
    where: { workspaceId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MEMBER"] } },
    select: { role: true, user: { select: { id: true, name: true, image: true, disabledAt: true } } },
    orderBy: { user: { name: "asc" } },
  });
  let people = memberships.filter((m) => !m.user.disabledAt);
  if (project?.teamId) {
    const team = await client.team.findFirst({ where: { id: project.teamId, workspaceId }, select: { visibility: true, members: { select: { userId: true } } } });
    if (team?.visibility === "PRIVATE") {
      const inTeam = new Set(team.members.map((member) => member.userId));
      people = people.filter((m) => inTeam.has(m.user.id) || hasRoleAtLeast(m.role, "ADMIN"));
    }
  }
  return people.map((m) => ({ id: m.user.id, name: m.user.name, image: m.user.image }));
}

/**
 * Everyone (any role) who can see a project's tasks: used to filter
 * mentions and comment notifications.
 */
export async function projectViewerIds(workspaceId: string, project: { teamId: string | null } | null, client: DbClient = prisma): Promise<Set<string>> {
  const memberships = await client.membership.findMany({ where: { workspaceId, status: "ACTIVE" }, select: { userId: true, role: true } });
  if (!project?.teamId) return new Set(memberships.map((m) => m.userId));
  const team = await client.team.findFirst({ where: { id: project.teamId, workspaceId }, select: { visibility: true, members: { select: { userId: true } } } });
  if (team?.visibility !== "PRIVATE") return new Set(memberships.map((m) => m.userId));
  const inTeam = new Set(team.members.map((member) => member.userId));
  return new Set(memberships.filter((m) => inTeam.has(m.userId) || hasRoleAtLeast(m.role, "ADMIN")).map((m) => m.userId));
}

/** Realtime audience for a project: undefined (whole workspace) unless it belongs to a private team. */
export async function projectAudience(workspaceId: string, project: { teamId: string | null } | null, client: DbClient = prisma): Promise<string[] | undefined> {
  if (!project?.teamId) return undefined;
  const team = await client.team.findFirst({ where: { id: project.teamId, workspaceId }, select: { visibility: true } });
  if (team?.visibility !== "PRIVATE") return undefined;
  return [...(await projectViewerIds(workspaceId, project, client))];
}

import "server-only";
import type { Project } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";
import {
  canEditTasks,
  canManageProject,
  visibleProjectWhere,
  type TaskActor,
} from "@/lib/tasks/access";
import { taskCapabilities, type TaskCapabilities } from "@/lib/tasks/capabilities";
import type { LabelRef, ProjectPermissions, ProjectSummary } from "@/lib/tasks/types";
import { dateOnly } from "./formatters";

export function permissionsFor(actor: TaskActor, project: Pick<Project, "ownerId" | "status"> | null): ProjectPermissions {
  const archived = project?.status === "ARCHIVED";
  return {
    canEdit: canEditTasks(actor) && !archived,
    canComment: true,
    canManage: project ? canManageProject(actor, project) : hasRoleAtLeast(actor.membership.role, "ADMIN"),
  };
}

/** Per-task rights for the viewer; an archived project grants nothing. */
export function taskRights(actor: TaskActor, task: { creatorId: string | null; project: Pick<Project, "ownerId" | "status" | "restrictTaskEdits"> | null }, assigneeIds: readonly string[]): TaskCapabilities {
  if (task.project?.status === "ARCHIVED") return { canEdit: false, canClaim: false, canUnclaim: false, isAssignedToMe: assigneeIds.includes(actor.user.id) };
  return taskCapabilities({
    role: actor.membership.role,
    userId: actor.user.id,
    restrictTaskEdits: task.project?.restrictTaskEdits ?? false,
    projectOwnerId: task.project?.ownerId ?? null,
    creatorId: task.creatorId,
    assigneeIds,
  });
}

export async function projectSummary(project: Project): Promise<ProjectSummary> {
  const team = project.teamId ? await prisma.team.findUnique({ where: { id: project.teamId }, select: { name: true } }) : null;
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description,
    status: project.status,
    ownerId: project.ownerId,
    teamId: project.teamId,
    teamName: team?.name ?? null,
    cyclesEnabled: project.cyclesEnabled,
    restrictTaskEdits: project.restrictTaskEdits,
    startsOn: dateOnly(project.startsOn),
    dueOn: dateOnly(project.dueOn),
  };
}

export async function workspaceLabels(workspaceId: string): Promise<LabelRef[]> {
  return prisma.label.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true, tone: true } });
}

export async function findProjectByKey(actor: TaskActor, key: string) {
  if (!/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(key)) return null;
  return prisma.project.findFirst({ where: { AND: [await visibleProjectWhere(actor), { key: key.toUpperCase() }] } });
}

/** Open projects the actor can see, for "Move to project" (the task's own project excluded). */
export async function listTransferTargets(actor: TaskActor, excludeProjectId: string | null): Promise<Array<{ key: string; name: string }>> {
  return prisma.project.findMany({
    where: { AND: [await visibleProjectWhere(actor), { status: { not: "ARCHIVED" } }, ...(excludeProjectId ? [{ id: { not: excludeProjectId } }] : [])] },
    orderBy: { name: "asc" },
    take: 200,
    select: { key: true, name: true },
  });
}

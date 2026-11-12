import "server-only";
import type { Prisma, Visibility } from "@prisma/client";
import { prisma, type DbClient, type Tx } from "@/lib/db";
import type { TaskActor } from "@/lib/tasks/access";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";
import { hiddenTeamIds, teamScopeFilter, userTeamIds } from "@/lib/teamAccess";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument } from "@/lib/search/documents";
import { z } from "zod";

export type Actor = TaskActor;
export const id = z.string().trim().min(1).max(100);
export const title = z.string().trim().min(1, "Add a title.").max(200);
export const text = z.string().trim().max(50_000).default("");
export const optionalId = z.preprocess(
  (v) => (v === "" ? null : v),
  id.nullish(),
);
export const date = z.coerce.date();
export class CollaborationError extends Error {}
export function ensure(
  value: unknown,
  message = "You don't have access to do that.",
): asserts value {
  if (!value) throw new CollaborationError(message);
}
export const admin = (actor: Actor) =>
  hasRoleAtLeast(actor.membership.role, "ADMIN");

export async function assertActor(
  actor: Actor,
  client: DbClient = prisma,
  contribute = true,
) {
  const member = await activeMemberOrSuperAdmin(client, actor);
  ensure(
    member &&
      member.role === actor.membership.role &&
      (!contribute || canContribute(member)),
  );
}

export async function teamWhere(actor: Actor, client: DbClient = prisma) {
  return teamScopeFilter(
    await hiddenTeamIds(
      actor.workspace.id,
      { userId: actor.user.id, role: actor.membership.role },
      client,
    ),
  );
}

type VisibilityFilter = {
  AND?: VisibilityFilter[];
  OR?: VisibilityFilter[];
  teamId?: string | null | { in?: string[]; notIn?: string[] };
  visibility?: Visibility;
  createdById?: string;
};
export async function visibilityWhere(
  actor: Actor,
  client: DbClient = prisma,
): Promise<VisibilityFilter> {
  const teams = await userTeamIds(actor.workspace.id, actor.user.id, client);
  return admin(actor)
    ? {}
    : {
        AND: [
          await teamWhere(actor, client),
          {
            OR: [
              { visibility: "WORKSPACE" as const },
              { visibility: "TEAM" as const, teamId: { in: teams } },
              { createdById: actor.user.id },
            ],
          },
        ],
      };
}

export async function checkTeam(
  actor: Actor,
  teamId: string | null | undefined,
  client: DbClient,
) {
  if (!teamId) return;
  const hidden = await hiddenTeamIds(
    actor.workspace.id,
    { userId: actor.user.id, role: actor.membership.role },
    client,
  );
  ensure(
    !hidden.includes(teamId) &&
      (await client.team.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: teamId,
          archivedAt: null,
        },
      })),
  );
}

export async function checkMembers(
  actor: Actor,
  ids: string[],
  client: DbClient,
  teamId?: string | null,
) {
  const unique = [...new Set(ids)];
  const rows = await client.membership.findMany({
    where: {
      workspaceId: actor.workspace.id,
      userId: { in: unique },
      status: "ACTIVE",
      user: { disabledAt: null },
    },
  });
  ensure(
    rows.length === unique.length,
    "Choose active members of this workspace.",
  );
  if (teamId) {
    const team = await client.team.findFirst({
      where: { workspaceId: actor.workspace.id, id: teamId },
      include: { members: true },
    });
    ensure(team);
    ensure(
      rows.every(
        (m) =>
          hasRoleAtLeast(m.role, "ADMIN") ||
          team.members.some((t) => t.userId === m.userId),
      ),
      "Choose members of this team.",
    );
  }
}

export async function changed(
  tx: Tx,
  actor: Actor,
  entityType: string,
  entityId: string,
  name: string,
  route: string,
  verb = "created",
  body = "",
  scope: {
    teamId?: string | null;
    visibility?: Visibility;
    projectId?: string | null;
    ownerId?: string | null;
  } = {},
) {
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `${entityType}.${verb}`,
    targetType: entityType,
    targetId: entityId,
    client: tx,
  });
  await recordActivity(
    {
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      entityType,
      entityId,
      verb,
      summary: `${verb} ${name}`.slice(0, 300),
      ...scope,
    },
    tx,
  );
  await indexSearchDocument(
    {
      workspaceId: actor.workspace.id,
      entityType,
      entityId,
      title: name,
      body,
      url: `/w/${actor.workspace.slug}/${route}`,
      ownerId: scope.ownerId ?? actor.user.id,
      ...scope,
    },
    tx,
  );
}

/** Serializable write with retries; jittered backoff stops colliding writers retrying in lockstep. */
export async function serial<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: "Serializable",
        timeout: 15_000,
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2034" || attempt >= 5)
        throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 10 * 2 ** attempt + Math.random() * 25 * (attempt + 1)),
      );
    }
  }
}

export function jsonObject(
  value: Prisma.JsonValue | unknown,
): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

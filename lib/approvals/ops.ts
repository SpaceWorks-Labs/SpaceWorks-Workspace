import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument } from "@/lib/search/documents";
import { hasRoleAtLeast } from "@/lib/roles";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { hiddenTeamIds } from "@/lib/teamAccess";
import type { OpsActor } from "./context";

export class OpsError extends Error {}
export const id = z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
export const title = z.string().trim().min(1).max(200);
export const minor = z.coerce.number().int().min(0).max(2_000_000_000);
export const currency = z.string().regex(/^[A-Z]{3}$/).default("INR");
export const optionalId = z.preprocess(v => v === "" ? null : v, id.nullable().optional());
export const optionalDate = z.preprocess(v => v === "" ? null : v, z.coerce.date().nullable().optional());
export const webUrl = z.preprocess(v => v === "" ? null : v, z.url().max(2000).refine(v => /^https?:\/\//.test(v), "Use an HTTP or HTTPS URL.").nullable().optional());
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
 const result = schema.safeParse(input);
 if (!result.success) throw new OpsError(result.error.issues[0]?.message ?? "Check the fields and try again.");
 return result.data;
}
export async function guard(actor: OpsActor, admin = false, client: DbClient = prisma) {
 const m = await activeMemberOrSuperAdmin(client, actor);
 if (!m || !hasRoleAtLeast(m.role, admin ? "ADMIN" : "MEMBER") || m.role !== actor.membership.role) throw new OpsError("You don't have access to this action.");
}
export async function memberRef(actor: OpsActor, userId?: string | null, client: DbClient = prisma) {
 if (userId && !await client.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId, status: "ACTIVE", user: { disabledAt: null } } })) throw new OpsError("Choose a member of this workspace.");
}
export async function teamRef(actor: OpsActor, teamId?: string | null, client: DbClient = prisma) {
 if (teamId && !await client.team.findFirst({ where: { id: teamId, workspaceId: actor.workspace.id, archivedAt: null } })) throw new OpsError("Choose a team in this workspace.");
 if (teamId && (await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role })).includes(teamId)) throw new OpsError("You don't have access to this team.");
}
export async function note(actor: OpsActor, type: string, entityId: string, verb: string, client: DbClient = prisma) {
 await recordAuditEvent({ client, workspaceId: actor.workspace.id, actorId: actor.user.id, action: `${type}.${verb}`, targetType: type, targetId: entityId });
}
export async function searchable(actor: OpsActor, type: string, entityId: string, name: string, path: string, teamId?: string | null, client: DbClient = prisma) {
 await indexSearchDocument({ workspaceId: actor.workspace.id, entityType: type, entityId, title: name, url: `/w/${actor.workspace.slug}/${path}`, teamId, visibility: teamId ? "TEAM" : "WORKSPACE" }, client);
 await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, entityType: type, entityId, verb: "saved", summary: `${name} saved`, teamId, visibility: teamId ? "TEAM" : "WORKSPACE" }, client);
}
export async function lockAsset(tx: Prisma.TransactionClient, workspaceId: string, assetId: string) {
 const rows = await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "Asset" WHERE "id" = ${assetId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
 if (!rows.length) throw new OpsError("That equipment is unavailable.");
}

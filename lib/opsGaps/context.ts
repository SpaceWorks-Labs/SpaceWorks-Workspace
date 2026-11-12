import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { canManageInternalOperations, canUseInternalOperations } from "@/lib/roles";
import type { OpsActor } from "@/lib/approvals/context";
import { recordAuditEvent } from "@/lib/audit";
import { indexSearchDocument } from "@/lib/search/documents";
import { recordActivity } from "@/lib/activity";
import { dispatch } from "@/lib/notify";
import type { EventType } from "@/lib/notify/events";
import type { DispatchResult } from "@/lib/notify/types";
export type { OpsActor };
export class OperationsError extends Error {
  constructor(message: string, public fieldErrors?: Record<string, string[]>) { super(message); }
}
export const unavailable = () => new OperationsError("That record is unavailable. Refresh and try again.");
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string[]> = {};
    for (const issue of result.error.issues) (fields[issue.path.join(".")] ??= []).push(issue.message);
    throw new OperationsError(result.error.issues[0]?.message ?? "Check the fields and try again.", fields);
  }
  return result.data;
}
/** Recheck live membership for reads and inside every write transaction. */
export async function guard(actor: OpsActor, manager = false, client: DbClient = prisma) {
  const m = await activeMemberOrSuperAdmin(client, actor);
  if (!m || m.role !== actor.membership.role || !(manager ? canManageInternalOperations(m) : canUseInternalOperations(m))) throw new OperationsError("You do not have access to this action.");
}
export async function requireKeyholder(actor: OpsActor, client: DbClient = prisma) {
  await guard(actor, false, client);
  if (admin(actor)) return;
  if (!await client.memberProfile.findFirst({ where: { workspaceId: actor.workspace.id, userId: actor.user.id, isKeyholder: true }, select: { id: true } })) throw new OperationsError("A keyholder or admin must sign off this checklist.");
}
export const admin = (actor: OpsActor) => canManageInternalOperations(actor.membership);
export async function adminIds(workspaceId: string, client: DbClient = prisma) {
  return (await client.membership.findMany({ where: { workspaceId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] }, user: { disabledAt: null } }, select: { userId: true } })).map(m => m.userId);
}
export async function adminRef(actor: OpsActor, userId: string, client: DbClient) {
  if (!await client.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] }, user: { disabledAt: null } }, select: { id: true } })) throw new OperationsError("Choose an active admin in this workspace.");
}
export async function audit(actor: OpsActor, type: string, entityId: string, verb: string, client: DbClient) {
  await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: `ops_gaps.${type}.${verb}`, targetType: type, targetId: entityId, client });
}
export async function activity(actor: OpsActor, entityType: string, entityId: string, summary: string, client: DbClient, privateRecord = false) {
  await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "created", entityType, entityId, summary, visibility: privateRecord ? "PRIVATE" : "WORKSPACE" }, client);
}
export async function index(actor: OpsActor, type: string, entityId: string, title: string, path: string, client: DbClient, ownerId?: string) {
  await indexSearchDocument({ workspaceId: actor.workspace.id, entityType: type, entityId, title, url: `/w/${actor.workspace.slug}/${path}/${entityId}`, visibility: ownerId ? "PRIVATE" : "WORKSPACE", ownerId }, client);
}
type OpsEvent = Extract<EventType, `ops.${string}`>;
export type Emit = (type: OpsEvent, entityId: string, title: string, path: string, recipients: string[]) => Promise<void>;
/** Personal-only events; confidential text never goes through routing rules. */
export async function write<T>(actor: OpsActor, key: string, manager: boolean, work: (tx: Prisma.TransactionClient, emit: Emit) => Promise<T>) {
  const events: DispatchResult[] = [];
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ops_gaps:${actor.workspace.id}:${key}`}))`;
    await guard(actor, manager, tx);
    const emit: Emit = async (type, entityId, title, path, recipients) => {
      events.push(await dispatch(actor.workspace.id, { type, title, url: `/w/${actor.workspace.slug}/${path}${["onboarding","leave","safety/facilities","safety/inspections"].includes(path)?"#":"/"}${entityId}`, actorId: actor.user.id, recipients: [...new Set(recipients)], resource: { type: path, id: entityId }, useWorkspaceRules: false, data: { recordId: entityId } }, { tx }));
    };
    return work(tx, emit);
  }, { timeout: 15000 });
  await Promise.all(events.map(e => e.afterCommit()));
  return result;
}
export async function members(actor: OpsActor) {
  await guard(actor);
  return prisma.membership.findMany({ where: { workspaceId: actor.workspace.id, status: "ACTIVE", user: { disabledAt: null } }, select: { userId: true, role: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } });
}
export async function names(actor: OpsActor, ids: Array<string | null>) {
  await guard(actor);
  const rows = await prisma.membership.findMany({ where: { workspaceId: actor.workspace.id, userId: { in: ids.filter((v): v is string => Boolean(v)) } }, select: { userId: true, user: { select: { name: true } } } });
  return Object.fromEntries(rows.map(r => [r.userId, r.user.name ?? "Member"]));
}

export async function indexSingle(actor: OpsActor, type: string, entityId: string, title: string, path: string, client: DbClient, ownerId = actor.user.id) {
  await indexSearchDocument({ workspaceId: actor.workspace.id, entityType: type, entityId, title, url: `/w/${actor.workspace.slug}/${path}#${entityId}`, visibility: "PRIVATE", ownerId }, client);
}

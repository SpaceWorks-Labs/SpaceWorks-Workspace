import "server-only";

import { Prisma } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { prisma, type DbClient } from "@/lib/db";
import { getInstanceSettings } from "@/lib/instanceSettings";
import { isValidWorkspaceSlug } from "@/lib/slug";
import { createWorkspaceWithDefaults } from "@/lib/workspaces";
import { MAX_PENDING_PER_USER, MAX_PENDING_PER_WORKSPACE } from "./constants";
import { emailRequester, emailSuperAdmin } from "./notify";
import { featureSchema, moreLimitSchema, newOrgSchema } from "./schemas";
import { describeRequest } from "./summary";
import { fail, type OrgRequestInput, type ServiceResult } from "./types";

type Created = { requestId: string; status: "PENDING" | "APPROVED"; workspaceSlug: string | null };

/** Why a slug cannot be used, or null when it is free (live workspaces and pending requests, except `exceptRequestId`, count). */
export async function slugProblem(db: DbClient, slug: string, exceptRequestId?: string): Promise<string | null> {
  if (!isValidWorkspaceSlug(slug)) return "Use 1 to 60 lowercase letters, numbers or hyphens, and avoid reserved words like admin or settings.";
  const [workspace, pending] = await Promise.all([
    db.workspace.findUnique({ where: { slug }, select: { id: true } }),
    db.orgRequest.findFirst({ where: { kind: "NEW_ORG", status: "PENDING", requestedSlug: slug, ...(exceptRequestId ? { id: { not: exceptRequestId } } : {}) }, select: { id: true } }),
  ]);
  return workspace || pending ? "That address is taken. Try another." : null;
}

/** ACTIVE workspaces the user owns, plus their pending new-organisation requests. */
async function ownedAndPending(db: DbClient, userId: string): Promise<number> {
  const [owned, pending] = await Promise.all([
    db.membership.count({ where: { userId, role: "OWNER", status: "ACTIVE", workspace: { status: "ACTIVE", archivedAt: null } } }),
    db.orgRequest.count({ where: { requestedById: userId, kind: "NEW_ORG", status: "PENDING" } }),
  ]);
  return owned + pending;
}

async function createNewOrg(userId: string, raw: unknown): Promise<ServiceResult<Created>> {
  const parsed = newOrgSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form.", { [String(parsed.error.issues[0]?.path[0] ?? "name")]: [parsed.error.issues[0]?.message ?? "Check this field."] });
  const { name, slug, message } = parsed.data;
  const settings = await getInstanceSettings(["workspaces.requireApproval", "limits.maxWorkspacesPerOwner"]);
  const auto = settings["workspaces.requireApproval"]?.trim().toLowerCase() === "false";
  const result = await prisma.$transaction(async (tx): Promise<ServiceResult<Created>> => {
    // Serialise one user's concurrent requests so the caps cannot be raced.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`org-request:${userId}`}))`;
    const pendingNow = await tx.orgRequest.count({ where: { requestedById: userId, kind: "NEW_ORG", status: "PENDING" } });
    if (pendingNow >= MAX_PENDING_PER_USER) return fail(`You already have ${MAX_PENDING_PER_USER} requests waiting. Cancel one or wait for a decision.`);
    const cap = Number(settings["limits.maxWorkspacesPerOwner"]?.trim());
    if (settings["limits.maxWorkspacesPerOwner"]?.trim() && Number.isSafeInteger(cap) && cap >= 0 && (await ownedAndPending(tx, userId)) >= cap) {
      return fail(`You can own up to ${cap} ${cap === 1 ? "organisation" : "organisations"} here. Ask the instance admin to raise it.`);
    }
    const problem = await slugProblem(tx, slug);
    if (problem) return fail(problem, { slug: [problem] });
    const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    if (!user) return fail("Sign in again to continue.");
    const request = await tx.orgRequest.create({
      data: { kind: "NEW_ORG", requestedById: userId, requestedName: name, requestedSlug: slug, message: message || null, ...(auto ? { status: "APPROVED", decidedAt: new Date(), decisionNote: "Approved automatically." } : {}) },
      select: { id: true },
    });
    if (auto) {
      const workspace = await createWorkspaceWithDefaults(tx, { name, slug, ownerId: userId });
      await tx.orgRequest.update({ where: { id: request.id }, data: { workspaceId: workspace.id } });
      return { ok: true, data: { requestId: request.id, status: "APPROVED", workspaceSlug: workspace.slug } };
    }
    const summary = describeRequest({ kind: "NEW_ORG", requestedName: name, payload: {} });
    await emailSuperAdmin(tx, { summary, requesterName: user.name ?? user.email, message });
    await emailRequester(tx, { to: user.email, summary });
    return { ok: true, data: { requestId: request.id, status: "PENDING", workspaceSlug: null } };
  }, { timeout: 15_000 });
  if (result.ok) await recordAuditEvent({ action: "workspace.requested", actorId: userId, targetType: "OrgRequest", targetId: result.data.requestId, metadata: { kind: "NEW_ORG", slug, autoApproved: auto } });
  return result;
}

async function createForWorkspace(userId: string, input: Extract<OrgRequestInput, { kind: "MORE_LIMIT" | "FEATURE" }>): Promise<ServiceResult<Created>> {
  const parsed = input.kind === "MORE_LIMIT"
    ? moreLimitSchema.safeParse({ limit: input.limit, requested: input.requested, message: input.message })
    : featureSchema.safeParse({ module: input.module, message: input.message });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form.");
  const payload: Prisma.InputJsonObject = input.kind === "MORE_LIMIT"
    ? { limit: (parsed.data as { limit: string }).limit, requested: (parsed.data as { requested: number }).requested }
    : { module: (parsed.data as { module: string }).module };
  const message = parsed.data.message || null;
  const result = await prisma.$transaction(async (tx): Promise<ServiceResult<Created>> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`org-request-ws:${input.workspaceId}`}))`;
    const membership = await tx.membership.findFirst({ where: { workspaceId: input.workspaceId, userId, role: "OWNER", status: "ACTIVE" }, select: { workspace: { select: { name: true } }, user: { select: { name: true, email: true } } } });
    if (!membership) return fail("Only an organisation owner can send this request.");
    const pending = await tx.orgRequest.findMany({ where: { workspaceId: input.workspaceId, status: "PENDING" }, select: { kind: true, payload: true } });
    if (pending.length >= MAX_PENDING_PER_WORKSPACE) return fail(`This organisation already has ${MAX_PENDING_PER_WORKSPACE} requests waiting. Wait for a decision first.`);
    const field = input.kind === "MORE_LIMIT" ? "limit" : "module";
    const same = pending.some((row) => row.kind === input.kind && (row.payload as Record<string, unknown> | null)?.[field] === payload[field]);
    if (same) return fail("You already asked for this. The instance admin will reply soon.");
    const request = await tx.orgRequest.create({ data: { kind: input.kind, workspaceId: input.workspaceId, requestedById: userId, payload, message }, select: { id: true } });
    const summary = describeRequest({ kind: input.kind, requestedName: null, payload }, membership.workspace.name);
    await emailSuperAdmin(tx, { summary, requesterName: membership.user.name ?? membership.user.email, message });
    return { ok: true, data: { requestId: request.id, status: "PENDING", workspaceSlug: null } };
  }, { timeout: 15_000 });
  if (result.ok) await recordAuditEvent({ action: "workspace.requested", workspaceId: input.workspaceId, actorId: userId, targetType: "OrgRequest", targetId: result.data.requestId, metadata: { kind: input.kind } });
  return result;
}

/**
 * Create a request. Rate limiting is the caller's job (needs request headers).
 * NEW_ORG: any signed-in user; MORE_LIMIT / FEATURE: owners of the workspace only.
 */
export async function createOrgRequest(userId: string, input: OrgRequestInput): Promise<ServiceResult<Created>> {
  return input.kind === "NEW_ORG" ? createNewOrg(userId, input) : createForWorkspace(userId, input);
}

/** The requester withdraws a request that is still pending. */
export async function cancelOrgRequest(userId: string, requestId: string): Promise<ServiceResult<null>> {
  const done = await prisma.orgRequest.updateMany({ where: { id: requestId, requestedById: userId, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } });
  if (done.count === 0) return fail("That request is no longer waiting.");
  const row = await prisma.orgRequest.findUnique({ where: { id: requestId }, select: { workspaceId: true, kind: true } });
  await recordAuditEvent({ action: "workspace.request_cancelled", workspaceId: row?.workspaceId ?? null, actorId: userId, targetType: "OrgRequest", targetId: requestId, metadata: { kind: row?.kind ?? null } });
  return { ok: true, data: null };
}

import "server-only";

import { Prisma, type OrgRequest } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { invalidateLimits } from "@/lib/limits";
import { createWorkspaceWithDefaults } from "@/lib/workspaces";
import { REQUESTABLE_LIMITS, REQUESTABLE_MODULES, type RequestableLimit } from "./constants";
import { notifyDecision } from "./notify";
import { decisionNoteSchema } from "./schemas";
import { describeRequest } from "./summary";
import { fail, type ServiceResult } from "./types";

type Decided = { request: OrgRequest; workspaceSlug: string | null };
const STALE = "This request was already decided or withdrawn.";

/** Apply the approved change of a MORE_LIMIT or FEATURE request inside the decision transaction. */
async function applyApproved(tx: Prisma.TransactionClient, request: OrgRequest, decidedById: string): Promise<string | null> {
  if (!request.workspaceId) return "This request has no organisation.";
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  const workspaceId = request.workspaceId;
  const existing = await tx.workspaceLimits.findUnique({ where: { workspaceId }, select: { disabledModules: true, enabledModules: true } });
  if (request.kind === "MORE_LIMIT") {
    const key = String(payload.limit) as RequestableLimit;
    const requested = Number(payload.requested);
    if (!(key in REQUESTABLE_LIMITS) || !Number.isSafeInteger(requested) || requested < 1 || (key !== "maxStorageBytes" && requested > 2_147_483_647)) return "The requested limit is not valid.";
    const value = key === "maxStorageBytes" ? BigInt(requested) : requested;
    await tx.workspaceLimits.upsert({ where: { workspaceId }, create: { workspaceId, [key]: value, updatedById: decidedById }, update: { [key]: value, updatedById: decidedById } });
  } else if (request.kind === "FEATURE") {
    const moduleKey = String(payload.module);
    if (!REQUESTABLE_MODULES.includes(moduleKey)) return "The requested feature is not valid.";
    const disabledModules = (existing?.disabledModules ?? []).filter((key) => key !== moduleKey);
    const enabledModules = moduleKey.includes(".") || (existing?.enabledModules ?? []).includes(moduleKey) ? (existing?.enabledModules ?? []) : [...(existing?.enabledModules ?? []), moduleKey];
    await tx.workspaceLimits.upsert({ where: { workspaceId }, create: { workspaceId, disabledModules, enabledModules, updatedById: decidedById }, update: { disabledModules, enabledModules, updatedById: decidedById } });
  }
  return null;
}

async function decide(requestId: string, decision: "APPROVED" | "REJECTED", decidedById: string, note?: string | null): Promise<ServiceResult<Decided>> {
  const parsedNote = decisionNoteSchema.safeParse(note);
  if (!parsedNote.success) return fail(parsedNote.error.issues[0]?.message ?? "Check the note.");
  const decisionNote = parsedNote.data?.trim() || null;
  if (decision === "REJECTED" && !decisionNote) return fail("Add a short reason so the requester knows why.", { note: ["Add a short reason."] });

  const outcome = await prisma.$transaction(async (tx): Promise<ServiceResult<Decided>> => {
    const claimed = await tx.orgRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: decision, decidedById, decidedAt: new Date(), decisionNote },
    });
    if (claimed.count === 0) return fail(STALE);
    let request = await tx.orgRequest.findUniqueOrThrow({ where: { id: requestId } });
    let slug: string | null = null;
    if (decision === "APPROVED") {
      if (request.kind === "NEW_ORG") {
        if (!request.requestedName || !request.requestedSlug) throw new RollbackError("This request is missing a name or address.");
        if (await tx.workspace.findUnique({ where: { slug: request.requestedSlug }, select: { id: true } })) throw new RollbackError("That address is now taken. Reject the request and ask for a new one.");
        const workspace = await createWorkspaceWithDefaults(tx, { name: request.requestedName, slug: request.requestedSlug, ownerId: request.requestedById });
        request = await tx.orgRequest.update({ where: { id: requestId }, data: { workspaceId: workspace.id } });
        slug = workspace.slug;
      } else {
        const problem = await applyApproved(tx, request, decidedById);
        if (problem) throw new RollbackError(problem);
      }
    }
    return { ok: true, data: { request, workspaceSlug: slug } };
  }, { timeout: 20_000 }).catch((error: unknown): ServiceResult<Decided> => {
    if (error instanceof RollbackError) return fail(error.message);
    throw error;
  });
  if (!outcome.ok) return outcome;

  const { request } = outcome.data;
  if (request.workspaceId) invalidateLimits(request.workspaceId);
  let workspaceSlug = outcome.data.workspaceSlug;
  let workspaceName: string | null = request.requestedName;
  if (request.workspaceId && !workspaceSlug) {
    const workspace = await prisma.workspace.findUnique({ where: { id: request.workspaceId }, select: { slug: true, name: true } });
    workspaceSlug = workspace?.slug ?? null;
    workspaceName = workspace?.name ?? null;
  }
  await recordAuditEvent({ action: decision === "APPROVED" ? "workspace.request_approved" : "workspace.request_rejected", workspaceId: request.workspaceId, actorId: decidedById, targetType: "OrgRequest", targetId: request.id, metadata: { kind: request.kind } });
  await notifyDecision(request, decision === "APPROVED", describeRequest(request, request.kind === "NEW_ORG" ? null : workspaceName), workspaceSlug).catch(() => undefined);
  return { ok: true, data: { request, workspaceSlug } };
}

class RollbackError extends Error {}

/** Approve a NEW_ORG request: creates the workspace (requester OWNER, ACTIVE, default channels). */
export async function applyNewOrgApproval(requestId: string, decidedById: string, note?: string | null): Promise<ServiceResult<Decided>> {
  const request = await prisma.orgRequest.findUnique({ where: { id: requestId }, select: { kind: true } });
  if (!request || request.kind !== "NEW_ORG") return fail("That is not a new-organisation request.");
  return decide(requestId, "APPROVED", decidedById, note);
}

/**
 * Approve or reject any request. MORE_LIMIT upserts the workspace limit, FEATURE enables the
 * module, NEW_ORG creates the workspace. A rejection needs a note. Deciding twice fails.
 */
export async function applyRequestDecision(requestId: string, decision: "APPROVED" | "REJECTED", decidedById: string, note?: string | null): Promise<ServiceResult<Decided>> {
  return decide(requestId, decision, decidedById, note);
}

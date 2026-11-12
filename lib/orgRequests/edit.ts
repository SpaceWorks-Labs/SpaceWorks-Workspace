import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { slugProblem } from "./create";
import { newOrgSchema } from "./schemas";
import { fail, type ServiceResult } from "./types";

/** Live check for the request form: null when the address is free, otherwise why not. */
export async function addressProblem(slug: string, exceptRequestId?: string): Promise<string | null> {
  return slugProblem(prisma, slug.trim().toLowerCase(), exceptRequestId);
}

/**
 * The requester changes the name, address or reason of their own new-organisation
 * request while it is still pending. Same rules as a new request; the decision
 * claim (`WHERE status = 'PENDING'`) makes an edit after a decision fail.
 */
export async function updateOrgRequest(userId: string, requestId: string, raw: unknown): Promise<ServiceResult<null>> {
  const parsed = newOrgSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(issue?.message ?? "Check the form.", { [String(issue?.path[0] ?? "name")]: [issue?.message ?? "Check this field."] });
  }
  const { name, slug, message } = parsed.data;
  const result = await prisma.$transaction(async (tx): Promise<ServiceResult<null>> => {
    // The same per-user lock as creating, so an edit and a new request cannot take one address twice.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`org-request:${userId}`}))`;
    const problem = await slugProblem(tx, slug, requestId);
    if (problem) return fail(problem, { slug: [problem] });
    const updated = await tx.orgRequest.updateMany({
      where: { id: requestId, requestedById: userId, kind: "NEW_ORG", status: "PENDING" },
      data: { requestedName: name, requestedSlug: slug, message: message || null },
    });
    if (updated.count === 0) return fail("That request is no longer waiting, so it can't be changed.");
    return { ok: true, data: null };
  }, { timeout: 15_000 });
  if (result.ok) await recordAuditEvent({ action: "workspace.request_updated", actorId: userId, targetType: "OrgRequest", targetId: requestId, metadata: { kind: "NEW_ORG", slug } });
  return result;
}

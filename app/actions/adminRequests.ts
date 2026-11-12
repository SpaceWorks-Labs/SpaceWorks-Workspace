"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { saveOrgLimits } from "@/lib/admin/limitsSave";
import { applyNewOrgApproval, applyRequestDecision } from "@/lib/orgRequests/service";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { actionError, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { idSchema } from "@/lib/validation";

const count = z.number().int().min(0).max(2_000_000_000).nullable();

const decideSchema = z.object({
  requestId: idSchema,
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(1000).optional(),
  /** Optional starting limits when approving a new organisation. Empty = inherit. */
  initialLimits: z.object({ maxMembers: count, maxGuests: count, maxProjects: count, maxStorageMb: count, plan: z.string().trim().max(60).nullable() }).optional(),
});

/** Approve or reject any request in the queue through the shared service (transactional, emails, notifications). */
export async function decideRequestAction(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdminMfa();
  if (await isActionRateLimited("action", session.user.id)) return actionError(RATE_LIMITED);
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { requestId, decision, note, initialLimits } = parsed.data;
  if (decision === "REJECTED" && !note) return actionError("Give a reason so the requester knows why.", { note: ["Give a reason."] });
  const request = await prisma.orgRequest.findUnique({ where: { id: requestId }, select: { kind: true, status: true } });
  if (!request) return actionError("That request wasn't found.");
  if (request.status !== "PENDING") return actionError("That request has already been decided.");

  const result =
    request.kind === "NEW_ORG" && decision === "APPROVED"
      ? await applyNewOrgApproval(requestId, session.user.id, note)
      : await applyRequestDecision(requestId, decision, session.user.id, note);
  if (!result.ok) return actionError(result.error, result.fieldErrors);

  if (request.kind === "NEW_ORG" && decision === "APPROVED" && initialLimits) {
    const created = result.data.request;
    const hasAny = Object.values(initialLimits).some((value) => value !== null && value !== "");
    if (created.workspaceId && hasAny) {
      await saveOrgLimits(
        {
          workspaceId: created.workspaceId, maxMembers: initialLimits.maxMembers, maxGuests: initialLimits.maxGuests, maxProjects: initialLimits.maxProjects,
          maxStorageMb: initialLimits.maxStorageMb, maxFileMb: null, maxApiTokens: null, maxWebhooks: null, assistantMonthlyTokens: null, monthlyEmailCap: null,
          assistantEnabled: "inherit", plan: initialLimits.plan || null, modules: {},
        },
        session.user.id,
      );
    }
  }
  revalidatePath("/admin/requests");
  revalidatePath("/admin/organisations");
  revalidatePath("/admin");
  return { ok: true };
}

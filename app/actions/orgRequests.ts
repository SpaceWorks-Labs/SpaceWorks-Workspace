"use server";

import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { revalidatePath } from "@/lib/frontend/cache";
import { getCurrentUser, getWorkspaceForAction } from "@/lib/permissions";
import { addressProblem, cancelOrgRequest, createOrgRequest, listRequestsForUser, updateOrgRequest } from "@/lib/orgRequests/service";
import { idSchema } from "@/lib/validation";

/**
 * Organisation requests from the requester side: a new organisation (any signed-in user),
 * more capacity or a feature (owners of that organisation). The super admin decides in /admin/requests.
 */

const slugSchema = z.string().min(1).max(64);

export async function requestNewOrganisation(input: unknown): Promise<ActionResult<{ requestId: string; workspaceSlug: string | null }>> {
  const user = await getCurrentUser();
  if (!user) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("orgRequest", user.id)) return actionError(RATE_LIMITED);
  const raw = (input ?? {}) as Record<string, unknown>;
  const result = await createOrgRequest(user.id, { kind: "NEW_ORG", name: String(raw.name ?? ""), slug: String(raw.slug ?? ""), message: typeof raw.message === "string" ? raw.message : null });
  if (!result.ok) return actionError(result.error, result.fieldErrors);
  revalidatePath("/account/organisations");
  revalidatePath("/");
  return { ok: true, data: { requestId: result.data.requestId, workspaceSlug: result.data.workspaceSlug } };
}

/** Change the name, address or reason of your own pending new-organisation request. */
export async function updateOrganisationRequest(requestId: unknown, input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  const id = idSchema.safeParse(requestId);
  if (!user || !id.success) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", user.id)) return actionError(RATE_LIMITED);
  const raw = (input ?? {}) as Record<string, unknown>;
  const result = await updateOrgRequest(user.id, id.data, { name: String(raw.name ?? ""), slug: String(raw.slug ?? ""), message: typeof raw.message === "string" ? raw.message : null });
  if (!result.ok) return actionError(result.error, result.fieldErrors);
  revalidatePath("/account/organisations");
  revalidatePath("/");
  return { ok: true };
}

/** Live availability for the address field. `requestId`: the request being edited keeps its own address. */
export async function checkOrganisationAddress(slug: unknown, requestId?: unknown): Promise<{ available: boolean; message: string | null }> {
  const user = await getCurrentUser();
  const parsed = slugSchema.safeParse(slug);
  if (!user || !parsed.success) return { available: false, message: null };
  if (await isActionRateLimited("action", user.id)) return { available: false, message: null };
  const except = idSchema.safeParse(requestId);
  const problem = await addressProblem(parsed.data, except.success ? except.data : undefined);
  return { available: !problem, message: problem };
}

export async function requestMoreLimit(slug: unknown, input: unknown): Promise<ActionResult> {
  const parsed = slugSchema.safeParse(slug);
  const ctx = parsed.success ? await getWorkspaceForAction(parsed.data, "OWNER") : null;
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("orgRequest", ctx.user.id)) return actionError(RATE_LIMITED);
  const raw = (input ?? {}) as Record<string, unknown>;
  const result = await createOrgRequest(ctx.user.id, { kind: "MORE_LIMIT", workspaceId: ctx.workspace.id, limit: String(raw.limit ?? ""), requested: Number(raw.requested), message: typeof raw.message === "string" ? raw.message : null });
  if (!result.ok) return actionError(result.error, result.fieldErrors);
  revalidatePath(`/w/${ctx.workspace.slug}/settings/plan`);
  return { ok: true };
}

export async function requestFeature(slug: unknown, input: unknown): Promise<ActionResult> {
  const parsed = slugSchema.safeParse(slug);
  const ctx = parsed.success ? await getWorkspaceForAction(parsed.data, "OWNER") : null;
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("orgRequest", ctx.user.id)) return actionError(RATE_LIMITED);
  const raw = (input ?? {}) as Record<string, unknown>;
  const result = await createOrgRequest(ctx.user.id, { kind: "FEATURE", workspaceId: ctx.workspace.id, module: String(raw.module ?? ""), message: typeof raw.message === "string" ? raw.message : null });
  if (!result.ok) return actionError(result.error, result.fieldErrors);
  revalidatePath(`/w/${ctx.workspace.slug}/settings/plan`);
  return { ok: true };
}

export async function cancelRequest(requestId: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  const id = idSchema.safeParse(requestId);
  if (!user || !id.success) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", user.id)) return actionError(RATE_LIMITED);
  const result = await cancelOrgRequest(user.id, id.data);
  if (!result.ok) return actionError(result.error);
  revalidatePath("/account/organisations");
  revalidatePath("/");
  return { ok: true };
}

/** Pending requests for the workspace switcher. */
export async function listMyPendingRequests(): Promise<{ id: string; name: string }[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const rows = await listRequestsForUser(user.id, 20);
  return rows.filter((row) => row.kind === "NEW_ORG" && row.status === "PENDING").map((row) => ({ id: row.id, name: row.requestedName ?? "Untitled" }));
}

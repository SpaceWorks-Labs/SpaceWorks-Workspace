"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { setInstanceSettings, type InstanceSettingKey } from "@/lib/instanceSettings";
import { invalidateLimits } from "@/lib/limits";
import { orgLimitsSchema } from "@/lib/admin/limitFields";
import { saveOrgLimits } from "@/lib/admin/limitsSave";
import { adminChangeRole, adminRemoveMember, adminSetStatus, reactivateOrganisation, suspendOrganisation, transferOwnership } from "@/lib/admin/orgMutations";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { actionError, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { idSchema, roleSchema } from "@/lib/validation";

async function gate(): Promise<{ id: string } | { error: ReturnType<typeof actionError> }> {
  const session = await requireSuperAdminMfa();
  if (await isActionRateLimited("action", session.user.id)) return { error: actionError(RATE_LIMITED) };
  return { id: session.user.id };
}

function done(workspaceId: string): { ok: true } {
  revalidatePath(`/admin/organisations/${workspaceId}`);
  revalidatePath("/admin/organisations");
  return { ok: true };
}

const suspendSchema = z.object({ workspaceId: idSchema, reason: z.string().trim().min(3, "Give a short reason.").max(500) });

export async function suspendOrgAction(input: unknown): Promise<ActionResult> {
  const actor = await gate();
  if ("error" in actor) return actor.error;
  const parsed = suspendSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await suspendOrganisation({ ...parsed.data, actorId: actor.id });
  return result.ok ? done(parsed.data.workspaceId) : actionError(result.error);
}

export async function reactivateOrgAction(input: unknown): Promise<ActionResult> {
  const actor = await gate();
  if ("error" in actor) return actor.error;
  const parsed = z.object({ workspaceId: idSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await reactivateOrganisation({ workspaceId: parsed.data.workspaceId, actorId: actor.id });
  return result.ok ? done(parsed.data.workspaceId) : actionError(result.error);
}

const transferSchema = z.object({ workspaceId: idSchema, membershipId: idSchema, demoteOthers: z.boolean() });

export async function transferOwnershipAction(input: unknown): Promise<ActionResult> {
  const actor = await gate();
  if ("error" in actor) return actor.error;
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await transferOwnership({ ...parsed.data, actorId: actor.id });
  return result.ok ? done(parsed.data.workspaceId) : actionError(result.error);
}

const memberSchema = z.object({ workspaceId: idSchema, membershipId: idSchema });

export async function adminChangeRoleAction(input: unknown): Promise<ActionResult> {
  const actor = await gate();
  if ("error" in actor) return actor.error;
  const parsed = memberSchema.extend({ role: roleSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await adminChangeRole({ ...parsed.data, actorId: actor.id });
  return result.ok ? done(parsed.data.workspaceId) : actionError(result.error);
}

export async function adminSetMemberStatusAction(input: unknown): Promise<ActionResult> {
  const actor = await gate();
  if ("error" in actor) return actor.error;
  const parsed = memberSchema.extend({ status: z.enum(["ACTIVE", "SUSPENDED"]) }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await adminSetStatus({ ...parsed.data, actorId: actor.id });
  return result.ok ? done(parsed.data.workspaceId) : actionError(result.error);
}

export async function adminRemoveMemberAction(input: unknown): Promise<ActionResult> {
  const actor = await gate();
  if ("error" in actor) return actor.error;
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await adminRemoveMember({ ...parsed.data, actorId: actor.id });
  return result.ok ? done(parsed.data.workspaceId) : actionError(result.error);
}

export async function saveOrgLimitsAction(input: unknown): Promise<ActionResult> {
  const actor = await gate();
  if ("error" in actor) return actor.error;
  const parsed = orgLimitsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (!(await saveOrgLimits(parsed.data, actor.id))) return actionError("That organisation wasn't found.");
  return done(parsed.data.workspaceId);
}

const countText = z.string().trim().regex(/^\d{1,12}$/, "Use a whole number, or leave empty.").or(z.literal(""));
const defaultsSchema = z.object({
  requireApproval: z.boolean(),
  maxMembers: countText, maxGuests: countText, maxProjects: countText, maxStorageBytes: countText, maxFileBytes: countText,
  maxApiTokens: countText, maxWebhooks: countText, assistantMonthlyTokens: countText, monthlyEmailCap: countText, maxWorkspacesPerOwner: countText,
  disabledByDefault: z.array(z.string().regex(/^[a-z][a-z.]{0,30}$/)).max(40),
});

/** Instance defaults for organisations. Empty means unlimited / inherit. */
export async function updateOrgDefaultsAction(input: unknown): Promise<ActionResult> {
  const actor = await gate();
  if ("error" in actor) return actor.error;
  const parsed = defaultsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { requireApproval, disabledByDefault, ...numbers } = parsed.data;
  const updates: Partial<Record<InstanceSettingKey, string | null>> = {
    "workspaces.requireApproval": requireApproval ? "true" : "false",
    "modules.disabledByDefault": disabledByDefault.length > 0 ? disabledByDefault.join(",") : null,
  };
  for (const [key, value] of Object.entries(numbers)) updates[`limits.${key}` as InstanceSettingKey] = value === "" ? null : value;
  await setInstanceSettings(updates, actor.id);
  invalidateLimits();
  await recordAuditEvent({ action: "admin.org_defaults_updated", actorId: actor.id, metadata: { keys: Object.keys(updates).join(",") } });
  revalidatePath("/admin/settings");
  return { ok: true };
}

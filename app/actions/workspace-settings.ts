"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { createInvitation, resendInvitation, revokeInvitation } from "@/lib/invitations";
import { changeMemberRole, removeMember, setMemberStatus } from "@/lib/membership";
import { getWorkspaceForAction } from "@/lib/permissions";
import { assignableRoles, canManageLabels, canManageMembers, canManageWorkspace } from "@/lib/roles";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { emailSchema, idSchema, labelToneSchema, roleSchema, workspaceSettingsSchema } from "@/lib/validation";

/**
 * Workspace settings mutations. Pattern for every action: resolve the
 * workspace from the slug server-side → check membership + capability →
 * rate limit → validate → mutate → audit → revalidate.
 */

const slugSchema = z.string().min(1).max(64);

async function context(slug: unknown) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  return getWorkspaceForAction(parsed.data, "GUEST", { module: "core" });
}

function revalidateSettings(slug: string) {
  revalidatePath(`/w/${slug}`, "layout");
}

export async function updateWorkspaceSettings(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx || !canManageWorkspace(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = workspaceSettingsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  await prisma.workspace.update({ where: { id: ctx.workspace.id }, data: parsed.data });
  await recordAuditEvent({
    action: "workspace.settings_updated",
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    targetType: "Workspace",
    targetId: ctx.workspace.id,
    metadata: { financeVisibleToMembers: parsed.data.financeVisibleToMembers },
  });
  revalidateSettings(ctx.workspace.slug);
  return { ok: true };
}

const inviteSchema = z.object({ email: emailSchema, role: roleSchema });

export async function createInvitationAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx || !canManageMembers(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("invite", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (!assignableRoles(ctx.membership).includes(parsed.data.role)) return actionError("You can't invite someone with that role.");
  const result = await createInvitation({
    workspace: ctx.workspace,
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: { id: ctx.user.id, name: ctx.user.name },
  });
  if (!result.ok) return actionError(result.error);
  revalidateSettings(ctx.workspace.slug);
  return { ok: true };
}

const invitationIdSchema = z.object({ invitationId: idSchema });

export async function resendInvitationAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx || !canManageMembers(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("invite", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = invitationIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await resendInvitation({ workspace: ctx.workspace, invitationId: parsed.data.invitationId, actor: { id: ctx.user.id, name: ctx.user.name } });
  if (!result.ok) return actionError(result.error);
  revalidateSettings(ctx.workspace.slug);
  return { ok: true };
}

export async function revokeInvitationAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx || !canManageMembers(ctx.membership)) return actionError(NOT_ALLOWED);
  const parsed = invitationIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await revokeInvitation({ workspaceId: ctx.workspace.id, invitationId: parsed.data.invitationId, actorId: ctx.user.id });
  if (!result.ok) return actionError(result.error);
  revalidateSettings(ctx.workspace.slug);
  return { ok: true };
}

const memberRoleSchema = z.object({ membershipId: idSchema, role: roleSchema });
const memberStatusSchema = z.object({ membershipId: idSchema, status: z.enum(["ACTIVE", "SUSPENDED"]) });
const memberIdSchema = z.object({ membershipId: idSchema });

export async function changeMemberRoleAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx || !canManageMembers(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = memberRoleSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await changeMemberRole({ actor: ctx.membership, ...parsed.data });
  if (!result.ok) return actionError(result.error);
  revalidateSettings(ctx.workspace.slug);
  return { ok: true };
}

export async function setMemberStatusAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx || !canManageMembers(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = memberStatusSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await setMemberStatus({ actor: ctx.membership, ...parsed.data });
  if (!result.ok) return actionError(result.error);
  revalidateSettings(ctx.workspace.slug);
  return { ok: true };
}

export async function removeMemberAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx || !canManageMembers(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = memberIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await removeMember({ actor: ctx.membership, membershipId: parsed.data.membershipId });
  if (!result.ok) return actionError(result.error);
  revalidateSettings(ctx.workspace.slug);
  return { ok: true };
}

/** Leave a workspace (any role; the sole owner is blocked). */
export async function leaveWorkspaceAction(slug: string): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (ctx.membership.viaSuperAdmin) return actionError("You're viewing this organisation as the instance admin, so there is nothing to leave.");
  const result = await removeMember({ actor: ctx.membership, membershipId: ctx.membership.id });
  if (!result.ok) return actionError(result.error);
  revalidatePath("/", "layout");
  return { ok: true };
}

const labelSchema = z.object({ name: z.string().trim().min(1, "Enter a label name.").max(40), tone: labelToneSchema });
const labelUpdateSchema = labelSchema.extend({ labelId: idSchema });

export async function createLabelAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx || !canManageLabels(ctx.membership)) return actionError(NOT_ALLOWED);
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const exists = await prisma.label.findUnique({ where: { workspaceId_name: { workspaceId: ctx.workspace.id, name: parsed.data.name } }, select: { id: true } });
  if (exists) return actionError("A label with that name already exists.");
  const label = await prisma.label.create({ data: { workspaceId: ctx.workspace.id, ...parsed.data } });
  await recordAuditEvent({ action: "label.created", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Label", targetId: label.id });
  revalidateSettings(ctx.workspace.slug);
  return { ok: true };
}

export async function updateLabelAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx || !canManageLabels(ctx.membership)) return actionError(NOT_ALLOWED);
  const parsed = labelUpdateSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const clash = await prisma.label.findFirst({ where: { workspaceId: ctx.workspace.id, name: parsed.data.name, NOT: { id: parsed.data.labelId } }, select: { id: true } });
  if (clash) return actionError("A label with that name already exists.");
  const updated = await prisma.label.updateMany({ where: { id: parsed.data.labelId, workspaceId: ctx.workspace.id }, data: { name: parsed.data.name, tone: parsed.data.tone } });
  if (updated.count !== 1) return actionError("That label wasn't found.");
  await recordAuditEvent({ action: "label.updated", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Label", targetId: parsed.data.labelId });
  revalidateSettings(ctx.workspace.slug);
  return { ok: true };
}

export async function deleteLabelAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx || !canManageLabels(ctx.membership)) return actionError(NOT_ALLOWED);
  const parsed = z.object({ labelId: idSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const deleted = await prisma.label.deleteMany({ where: { id: parsed.data.labelId, workspaceId: ctx.workspace.id } });
  if (deleted.count !== 1) return actionError("That label wasn't found.");
  await recordAuditEvent({ action: "label.deleted", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Label", targetId: parsed.data.labelId });
  revalidateSettings(ctx.workspace.slug);
  return { ok: true };
}

"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canManageApiTokens } from "@/lib/roles";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { idSchema } from "@/lib/validation";
import { generateTokenSecret } from "@/lib/apiTokens";
import { assertWithinLimit } from "@/lib/limits/enforce";
import { isApiScope, normalizeScopes } from "@/lib/apiTokens/scopes";

/**
 * API tokens (admins). The plain token is returned once by `createApiTokenAction`
 * and never stored; audit metadata never includes it.
 */

const slugSchema = z.string().min(1).max(64);
/** Hard safety ceiling when the workspace limit is unlimited (null). */
const MAX_ACTIVE_TOKENS = 200;

async function context(slug: unknown) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const ctx = await getWorkspaceForAction(parsed.data, "ADMIN");
  return ctx && canManageApiTokens(ctx.membership) ? ctx : null;
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name the token after what uses it.").max(80),
  scopes: z.array(z.string().refine(isApiScope, "Unknown scope.")).min(1, "Pick at least one scope.").max(20),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable(),
});

export async function createApiTokenAction(slug: string, input: unknown): Promise<ActionResult<{ token: string; prefix: string }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const active = await prisma.apiToken.count({ where: { workspaceId: ctx.workspace.id, revokedAt: null } });
  if (active >= MAX_ACTIVE_TOKENS) return actionError("This workspace has too many active tokens. Revoke unused ones first.");
  const limit = await assertWithinLimit("apiTokens", ctx.workspace.id);
  if (!limit.ok) return actionError(limit.error);
  const scopes = normalizeScopes(parsed.data.scopes);
  const secret = generateTokenSecret();
  const expiresAt = parsed.data.expiresInDays ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000) : null;
  const token = await prisma.apiToken.create({
    data: { workspaceId: ctx.workspace.id, name: parsed.data.name, prefix: secret.prefix, secretHash: secret.secretHash, scopes, expiresAt, createdById: ctx.user.id },
    select: { id: true },
  });
  await recordAuditEvent({
    action: "api_token.created",
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    targetType: "ApiToken",
    targetId: token.id,
    metadata: { scopes: scopes.join(","), expiresInDays: parsed.data.expiresInDays },
  });
  revalidatePath(`/w/${ctx.workspace.slug}/settings/api-tokens`);
  return { ok: true, data: { token: secret.token, prefix: secret.prefix } };
}

export async function revokeApiTokenAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ tokenId: idSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const revoked = await prisma.apiToken.updateMany({ where: { id: parsed.data.tokenId, workspaceId: ctx.workspace.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (revoked.count === 0) return actionError("That token was already revoked.");
  await recordAuditEvent({ action: "api_token.revoked", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "ApiToken", targetId: parsed.data.tokenId });
  revalidatePath(`/w/${ctx.workspace.slug}/settings/api-tokens`);
  return { ok: true };
}

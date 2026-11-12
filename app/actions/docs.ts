"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canManageDocVisibility } from "@/lib/docs/rules";
import { canContribute } from "@/lib/roles";
import { MAX_DOC_HTML_LENGTH } from "@/lib/docs/sanitize";
import {
  archiveDoc,
  createDoc,
  duplicateDoc,
  moveDoc,
  restoreDoc,
  restoreRevision,
  saveDoc,
  setDocVisibility,
  verifyDoc,
  type DocsActor,
} from "@/lib/docs/service";
import { idSchema } from "@/lib/validation";

/**
 * Docs mutations. Pattern: resolve the workspace from the slug server-side →
 * capability → rate limit → zod → lib/docs/service (Prisma transaction,
 * audit, search, realtime, notifications) → revalidate. Autosave does not
 * revalidate: the editor keeps its own state and the tree refreshes through
 * realtime.
 */

const slugSchema = z.string().min(1).max(64);

async function actor(slug: unknown): Promise<DocsActor | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const ctx = await getWorkspaceForAction(parsed.data, "GUEST", { module: "knowledge" });
  if (!ctx) return null;
  return { workspace: ctx.workspace, user: ctx.user, membership: ctx.membership };
}

function revalidateDocs(slug: string) {
  revalidatePath(`/w/${slug}/docs`, "layout");
}

const createSchema = z.object({
  parentId: idSchema.nullish(),
  title: z.string().max(200).nullish(),
  templateId: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9:_-]+$/).nullish(),
});

export async function createDocAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await createDoc(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateDocs(ctx.workspace.slug);
  return { ok: true, data: result.data };
}

const saveSchema = z.object({
  docId: idSchema,
  title: z.string().max(400),
  html: z.string().max(MAX_DOC_HTML_LENGTH, "This page is too long to save. Split it into sub-pages."),
  baseVersion: z.string().min(1).max(40),
});

export type SaveDocResult = { ok: true; data: { version: string; title: string } } | { ok: false; error: string; conflict?: boolean };

/** Autosave. A stale `baseVersion` returns `conflict: true` and nothing is written. */
export async function saveDocAction(slug: string, input: unknown): Promise<SaveDocResult> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", `doc-save:${ctx.user.id}`)) return actionError(RATE_LIMITED);
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return saveDoc(ctx, parsed.data);
}

const moveSchema = z.object({ docId: idSchema, parentId: idSchema.nullable(), index: z.number().int().min(0).max(10_000) });

export async function moveDocAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await moveDoc(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateDocs(ctx.workspace.slug);
  return { ok: true };
}

const visibilitySchema = z.object({ docId: idSchema, visibility: z.enum(["WORKSPACE", "ADMINS"]) });

export async function setDocVisibilityAction(slug: string, input: unknown): Promise<ActionResult<{ changed: number }>> {
  const ctx = await actor(slug);
  if (!ctx || !canManageDocVisibility(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = visibilitySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await setDocVisibility(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateDocs(ctx.workspace.slug);
  return { ok: true, data: result.data };
}

const docIdSchema = z.object({ docId: idSchema });

export async function archiveDocAction(slug: string, input: unknown): Promise<ActionResult<{ archived: number }>> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = docIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await archiveDoc(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateDocs(ctx.workspace.slug);
  return { ok: true, data: result.data };
}

export async function restoreDocAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = docIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await restoreDoc(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateDocs(ctx.workspace.slug);
  return { ok: true };
}

export async function duplicateDocAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = docIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await duplicateDoc(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateDocs(ctx.workspace.slug);
  return { ok: true, data: result.data };
}

const revisionSchema = z.object({ docId: idSchema, revisionId: idSchema });

export async function restoreRevisionAction(slug: string, input: unknown): Promise<ActionResult<{ version: string }>> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = revisionSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await restoreRevision(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateDocs(ctx.workspace.slug);
  return { ok: true, data: result.data };
}

const verifySchema = z.object({ docId: idSchema, days: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).nullable() });

export async function verifyDocAction(slug: string, input: unknown): Promise<ActionResult<{ verifiedUntil: string | null }>> {
  const ctx = await actor(slug);
  if (!ctx || !canContribute(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await verifyDoc(ctx, parsed.data);
  if (!result.ok) return actionError(result.error);
  revalidateDocs(ctx.workspace.slug);
  return { ok: true, data: result.data };
}

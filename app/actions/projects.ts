"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { getWorkspaceForAction } from "@/lib/permissions";
import { addColumn, createProject, deleteColumn, reorderColumns, setProjectArchived, updateColumn, updateProject } from "@/lib/projects/service";

/**
 * Projects and board columns. Pattern: resolve the workspace and membership
 * from the slug server-side → rate limit → lib/projects/service (capability,
 * Zod, transaction, audit, search, realtime) → revalidate.
 */

const slugSchema = z.string().min(1).max(64);

async function actor(slug: unknown) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  return getWorkspaceForAction(parsed.data, "GUEST", { module: "projects" });
}

function revalidateProjects(slug: string, key?: string) {
  revalidatePath(`/w/${slug}/projects`);
  if (key && /^[A-Z][A-Z0-9]{1,9}$/.test(key)) revalidatePath(`/w/${slug}/projects/${key}`, "layout");
}

async function run<T>(slug: unknown, fn: (ctx: NonNullable<Awaited<ReturnType<typeof actor>>>) => Promise<ActionResult<T>>, revalidate: (slug: string, result: ActionResult<T>) => void): Promise<ActionResult<T>> {
  const ctx = await actor(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const result = await fn(ctx);
  if (result.ok) revalidate(ctx.workspace.slug, result);
  return result;
}

export async function createProjectAction(slug: string, input: unknown) {
  return run(slug, (ctx) => createProject(ctx, input), (s) => revalidateProjects(s));
}

export async function updateProjectAction(slug: string, input: unknown, previousKey: string) {
  return run(slug, (ctx) => updateProject(ctx, input), (s, result) => {
    revalidateProjects(s, previousKey);
    if (result.ok && result.data?.key && result.data.key !== previousKey) revalidateProjects(s, result.data.key);
  });
}

export async function archiveProjectAction(slug: string, input: unknown, key: string) {
  return run(slug, (ctx) => setProjectArchived(ctx, input, true), (s) => revalidateProjects(s, key));
}

export async function restoreProjectAction(slug: string, input: unknown, key: string) {
  return run(slug, (ctx) => setProjectArchived(ctx, input, false), (s) => revalidateProjects(s, key));
}

export async function addColumnAction(slug: string, input: unknown, key: string) {
  return run(slug, (ctx) => addColumn(ctx, input), (s) => revalidateProjects(s, key));
}

export async function updateColumnAction(slug: string, input: unknown, key: string) {
  return run(slug, (ctx) => updateColumn(ctx, input), (s) => revalidateProjects(s, key));
}

export async function reorderColumnsAction(slug: string, input: unknown, key: string) {
  return run(slug, (ctx) => reorderColumns(ctx, input), (s) => revalidateProjects(s, key));
}

export async function deleteColumnAction(slug: string, input: unknown, key: string) {
  return run(slug, (ctx) => deleteColumn(ctx, input), (s) => revalidateProjects(s, key));
}

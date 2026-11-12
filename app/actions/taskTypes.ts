"use server";

import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { getWorkspaceForAction } from "@/lib/permissions";
import { createTaskType, deleteTaskType, listTaskTypes, reorderTaskTypes, setDefaultTaskType, updateTaskType } from "@/lib/tasks/service";

/**
 * Per-project task types (project settings). Same pattern as app/actions/tasks.ts:
 * workspace and membership from the slug server-side → rate limit → lib/tasks/service/types
 * (manage rights, Zod, audit, realtime).
 */

async function run<T>(slug: unknown, fn: (ctx: NonNullable<Awaited<ReturnType<typeof getWorkspaceForAction>>>) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const parsed = z.string().min(1).max(64).safeParse(slug);
  const ctx = parsed.success ? await getWorkspaceForAction(parsed.data, "GUEST") : null;
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  return fn(ctx);
}

export async function listTaskTypesAction(slug: string, projectId: string) {
  return run(slug, (ctx) => listTaskTypes(ctx, projectId));
}
export async function createTaskTypeAction(slug: string, input: unknown) {
  return run(slug, (ctx) => createTaskType(ctx, input));
}
export async function updateTaskTypeAction(slug: string, input: unknown) {
  return run(slug, (ctx) => updateTaskType(ctx, input));
}
export async function setDefaultTaskTypeAction(slug: string, input: unknown) {
  return run(slug, (ctx) => setDefaultTaskType(ctx, input));
}
export async function reorderTaskTypesAction(slug: string, input: unknown) {
  return run(slug, (ctx) => reorderTaskTypes(ctx, input));
}
export async function deleteTaskTypeAction(slug: string, input: unknown) {
  return run(slug, (ctx) => deleteTaskType(ctx, input));
}

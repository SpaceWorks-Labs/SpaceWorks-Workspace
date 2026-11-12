"use server";

import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { getWorkspaceForAction } from "@/lib/permissions";
import { assignTask, claimTask, unassignTask, unclaimTask } from "@/lib/tasks/service";

/**
 * Assignment actions for the task panel, board cards and keyboard shortcut.
 * Same pattern as app/actions/tasks.ts: resolve the workspace and membership
 * server-side → rate limit → lib/tasks/service/assignments (permission is
 * decided there, inside the transaction). Results carry the final assignee ids.
 */

type Assigned = { assigneeIds: string[] };

async function mutate(slug: unknown, fn: (ctx: NonNullable<Awaited<ReturnType<typeof getWorkspaceForAction>>>) => Promise<ActionResult<Assigned>>): Promise<ActionResult<Assigned>> {
  const parsed = z.string().min(1).max(64).safeParse(slug);
  const ctx = parsed.success ? await getWorkspaceForAction(parsed.data, "GUEST") : null;
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  return fn(ctx);
}

export async function assignTaskAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => assignTask(ctx, input));
}

export async function unassignTaskAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => unassignTask(ctx, input));
}

export async function claimTaskAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => claimTask(ctx, input));
}

export async function unclaimTaskAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => unclaimTask(ctx, input));
}

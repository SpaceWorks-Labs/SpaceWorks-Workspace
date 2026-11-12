"use server";

import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { getWorkspaceForAction } from "@/lib/permissions";
import { deleteTaskView, listTaskViews, saveTaskView, type TaskViewDTO } from "@/lib/tasks/views";

/** Saved task views (see lib/tasks/views): load, save and remove. */

const slugSchema = z.string().min(1).max(64);

async function actor(slug: unknown) {
  const parsed = slugSchema.safeParse(slug);
  return parsed.success ? getWorkspaceForAction(parsed.data, "GUEST") : null;
}

export async function loadTaskViewsAction(slug: string, projectKey: string): Promise<TaskViewDTO[]> {
  const ctx = await actor(slug);
  return ctx && typeof projectKey === "string" ? listTaskViews(ctx, projectKey) : [];
}

export async function saveTaskViewAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await actor(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  return saveTaskView(ctx, input);
}

export async function deleteTaskViewAction(slug: string, id: string): Promise<ActionResult> {
  const ctx = await actor(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  return deleteTaskView(ctx, id);
}

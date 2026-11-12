"use server";

import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { getWorkspaceForAction } from "@/lib/permissions";
import { MAX_BULK, type BulkResult } from "@/lib/tasks/bulkSchemas";
import { bulkUpdateTasks } from "@/lib/tasks/service";

/**
 * Bulk edit from the list view. Same pattern as app/actions/tasks.ts, but the
 * rate limit is weighted: a call over n tasks spends n units of the `bulk`
 * bucket (one per task, clamped to 1..50) so 50 operations cannot slip past
 * the per-action limit as a single request.
 */
export async function bulkUpdateTasksAction(slug: string, input: unknown): Promise<ActionResult<{ results: BulkResult[] }>> {
  const parsed = z.string().min(1).max(64).safeParse(slug);
  const ctx = parsed.success ? await getWorkspaceForAction(parsed.data, "GUEST") : null;
  if (!ctx) return actionError(NOT_ALLOWED);
  const count = Array.isArray((input as { taskIds?: unknown } | null)?.taskIds) ? (input as { taskIds: unknown[] }).taskIds.length : 1;
  if (await isActionRateLimited("bulk", ctx.user.id, Math.min(Math.max(count, 1), MAX_BULK))) return actionError(RATE_LIMITED);
  return bulkUpdateTasks(ctx, input);
}

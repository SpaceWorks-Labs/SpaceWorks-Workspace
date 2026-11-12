"use server";

import { z } from "zod";
import { revalidatePath } from "@/lib/frontend/cache";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { getWorkspaceForAction } from "@/lib/permissions";
import { listTransferTargets } from "@/lib/tasks/queries";
import { previewTransfer, transferTask } from "@/lib/tasks/service";
import type { TransferPreview } from "@/lib/tasks/service/transfer";

/** Moving a task to another project: picker data, confirmation preview, and the move itself. */

async function run<T>(slug: unknown, fn: (ctx: NonNullable<Awaited<ReturnType<typeof getWorkspaceForAction>>>) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const parsed = z.string().min(1).max(64).safeParse(slug);
  const ctx = parsed.success ? await getWorkspaceForAction(parsed.data, "GUEST") : null;
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  return fn(ctx);
}

export async function listTransferTargetsAction(slug: string, excludeProjectId: string | null): Promise<ActionResult<Array<{ key: string; name: string }>>> {
  return run(slug, async (ctx) => ({ ok: true, data: await listTransferTargets(ctx, typeof excludeProjectId === "string" ? excludeProjectId : null) }));
}

export async function previewTransferAction(slug: string, input: unknown): Promise<ActionResult<TransferPreview>> {
  return run(slug, (ctx) => previewTransfer(ctx, input));
}

export async function transferTaskAction(slug: string, input: unknown) {
  return run(slug, async (ctx) => {
    const result = await transferTask(ctx, input);
    if (result.ok) revalidatePath(`/w/${ctx.workspace.slug}/projects`, "layout");
    return result;
  });
}

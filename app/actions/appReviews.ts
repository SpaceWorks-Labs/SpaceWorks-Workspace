"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { getWorkspaceForAction, type WorkspaceContext } from "@/lib/permissions";
import { canManageAppReviews, canViewAppReviews } from "@/lib/roles";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { saveAccount, saveApp, saveSlackConfig, saveSlackMember, testAppConnection } from "@/lib/appReviews/settings";
import { replySchema } from "@/lib/appReviews/validation";
import { sendReviewReply } from "@/lib/appReviews/replies";
import { triageReview, createReviewTask } from "@/lib/appReviews/triage";
import { draftReply } from "@/lib/appReviews/draft";

async function mutate<T>(slug: string, manage: boolean, fn: (ctx: WorkspaceContext) => Promise<ActionResult<T>>, assistant = false): Promise<ActionResult<T>> {
  if (!z.string().min(1).max(64).safeParse(slug).success) return actionError(NOT_ALLOWED);
  const ctx = await getWorkspaceForAction(slug, manage ? "ADMIN" : "MEMBER", { module: "social" });
  if (!ctx || !(manage ? canManageAppReviews(ctx.membership) : canViewAppReviews(ctx.membership))) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited(assistant ? "assistant" : "action", ctx.user.id)) return actionError(RATE_LIMITED);
  try {
    const result = await fn(ctx);
    if (result.ok) revalidatePath(`/w/${slug}/app-reviews`, "layout");
    return result;
  } catch { return actionError("Couldn't complete that request. Reload to check its state before trying again."); }
}
export async function saveAppReviewAccountAction(slug: string, input: unknown) { return mutate(slug, true, ctx => saveAccount(ctx, input)); }
export async function saveReviewedAppAction(slug: string, input: unknown) { return mutate(slug, true, ctx => saveApp(ctx, input)); }
export async function saveAppReviewSlackAction(slug: string, input: unknown) { return mutate(slug, true, ctx => saveSlackConfig(ctx, input)); }
export async function saveAppReviewSlackMemberAction(slug: string, input: unknown) { return mutate(slug, true, ctx => saveSlackMember(ctx, input)); }
export async function testAppReviewConnectionAction(slug: string, id: string) { return mutate(slug, true, ctx => typeof id === "string" && id.length <= 100 ? testAppConnection(ctx, id) : Promise.resolve(actionError("Choose an app first."))); }
export async function triageAppReviewAction(slug: string, input: unknown) { return mutate(slug, false, ctx => triageReview(ctx, input)); }
export async function createAppReviewTaskAction(slug: string, input: unknown) {
  return mutate(slug, false, async ctx => {
    const result = await createReviewTask(ctx, input);
    if (result.ok) {
      revalidatePath(`/w/${slug}/my-tasks`);
      revalidatePath(`/w/${slug}/projects`, "layout");
    }
    return result;
  });
}
export async function draftAppReviewReplyAction(slug: string, reviewId: string) { return mutate(slug, false, ctx => typeof reviewId === "string" && reviewId.length <= 100 ? draftReply(ctx, reviewId) : Promise.resolve(actionError("Choose a review first.")), true); }
export async function sendAppReviewReplyAction(slug: string, input: unknown) {
  return mutate(slug, false, async ctx => {
    const parsed = replySchema.safeParse(input); if (!parsed.success) return actionError("Check the reply and reload before sending.");
    return sendReviewReply({ workspaceId: ctx.workspace.id, reviewId: parsed.data.reviewId, body: parsed.data.body, triggerKey: `workspace:${parsed.data.triggerKey}`, actorId: ctx.user.id, source: "WORKSPACE" });
  });
}

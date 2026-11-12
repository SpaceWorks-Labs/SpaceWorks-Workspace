"use server";
import { revalidatePath } from "@/lib/frontend/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { saveMilestone, removeMilestone, postStatusUpdate, saveTaskPlan } from "@/lib/projects/plusService";
import type { TaskActor } from "@/lib/tasks/access";

async function run<T>(slug: string, input: unknown, fn: (actor: TaskActor, input: unknown) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  if (typeof slug !== "string" || slug.length > 64) return actionError(NOT_ALLOWED);
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "projects" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", actor.user.id)) return actionError(RATE_LIMITED);
  const result = await fn(actor, input);
  if (result.ok) revalidatePath(`/w/${actor.workspace.slug}`, "layout");
  return result;
}
export async function saveMilestoneAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> { return run(slug, input, saveMilestone); }
export async function removeMilestoneAction(slug: string, input: unknown): Promise<ActionResult> { return run(slug, input, removeMilestone); }
export async function postProjectUpdateAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> { return run(slug, input, postStatusUpdate); }
export async function saveTaskPlanAction(slug: string, input: unknown): Promise<ActionResult> { return run(slug, input, saveTaskPlan); }

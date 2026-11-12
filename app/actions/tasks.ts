"use server";

import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { getWorkspaceForAction } from "@/lib/permissions";
import { getBoardData, getTaskDetail, listMyTasks } from "@/lib/tasks/queries";
import { setRecurrence, skipNextOccurrence, stopRecurrence } from "@/lib/tasks/recurrenceService";
import {
  addAttachment,
  addComment,
  addDependency,
  createTask,
  deleteComment,
  deleteTaskPermanently,
  editComment,
  moveTask,
  removeAttachment,
  removeDependency,
  setAssignees,
  setLabels,
  setTaskArchived,
  setTaskCompleted,
  updateTask,
  uploadDescriptionImage,
} from "@/lib/tasks/service";
import type { BoardData, MyTaskDTO, TaskDetailDTO } from "@/lib/tasks/types";

/**
 * Task mutations and the loaders the board, list, task detail and My tasks
 * use to refetch after realtime nudges. Pattern: resolve the workspace and
 * membership from the slug server-side → rate limit → lib/tasks (capability,
 * visibility, Zod, transaction, history, audit, dispatch, search, realtime).
 * Boards refetch through the loaders instead of revalidating the route.
 */

const slugSchema = z.string().min(1).max(64);

async function actor(slug: unknown) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  return getWorkspaceForAction(parsed.data, "GUEST");
}

type Ctx = NonNullable<Awaited<ReturnType<typeof actor>>>;

async function mutate<T>(slug: unknown, fn: (ctx: Ctx) => Promise<ActionResult<T>>, bucket: "action" | "upload" | "message" = "action"): Promise<ActionResult<T>> {
  const ctx = await actor(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited(bucket, ctx.user.id)) return actionError(RATE_LIMITED);
  return fn(ctx);
}

/* ---------- Loaders ---------- */

export async function loadBoardAction(slug: string, key: string): Promise<BoardData | null> {
  const ctx = await actor(slug);
  if (!ctx || typeof key !== "string") return null;
  return getBoardData(ctx, key);
}

export async function loadTaskAction(slug: string, number: number): Promise<TaskDetailDTO | null> {
  const ctx = await actor(slug);
  if (!ctx || !Number.isSafeInteger(number)) return null;
  return getTaskDetail(ctx, number);
}

export async function loadMyTasksAction(slug: string): Promise<MyTaskDTO[] | null> {
  const ctx = await actor(slug);
  if (!ctx) return null;
  return listMyTasks(ctx);
}

/* ---------- Mutations ---------- */

export async function createTaskAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => createTask(ctx, input));
}

export async function updateTaskAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => updateTask(ctx, input));
}

export async function moveTaskAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => moveTask(ctx, input));
}

export async function setTaskCompletedAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => setTaskCompleted(ctx, input));
}

export async function setAssigneesAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => setAssignees(ctx, input));
}

export async function setLabelsAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => setLabels(ctx, input));
}

export async function setTaskArchivedAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => setTaskArchived(ctx, input));
}

export async function addCommentAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => addComment(ctx, input), "message");
}

export async function editCommentAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => editComment(ctx, input), "message");
}

export async function deleteCommentAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => deleteComment(ctx, input));
}

export async function addDependencyAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => addDependency(ctx, input));
}

export async function removeDependencyAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => removeDependency(ctx, input));
}

export async function setRecurrenceAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => setRecurrence(ctx, input));
}

export async function stopRecurrenceAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => stopRecurrence(ctx, input));
}

export async function skipNextOccurrenceAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => skipNextOccurrence(ctx, input));
}

export async function uploadTaskAttachmentAction(slug: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const taskId = formData.get("taskId");
  const file = formData.get("file");
  if (typeof taskId !== "string" || !(file instanceof File) || file.size === 0) return actionError("Choose a file to attach.");
  return mutate(slug, (ctx) => addAttachment(ctx, taskId, file), "upload");
}

export async function removeTaskAttachmentAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => removeAttachment(ctx, input));
}

/** Admins and the project owner delete an archived task for good (type the project key to confirm). */
export async function deleteTaskPermanentlyAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => deleteTaskPermanently(ctx, input));
}

/** An image pasted or dropped into a task description. */
export async function uploadDescriptionImageAction(slug: string, formData: FormData): Promise<ActionResult<{ id: string; url: string; alt: string }>> {
  const taskId = formData.get("taskId");
  const file = formData.get("file");
  if (typeof taskId !== "string" || !(file instanceof File) || file.size === 0) return actionError("Choose an image to add.");
  return mutate(slug, (ctx) => uploadDescriptionImage(ctx, taskId, file), "upload");
}

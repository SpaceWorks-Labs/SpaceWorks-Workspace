"use server";

import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { getWorkspaceForAction } from "@/lib/permissions";
import {
  clearDoneTodos,
  createNote,
  createTodo,
  deleteNote,
  deleteTodo,
  getNotepad,
  moveTodo,
  sendTodoToTasks,
  setNoteArchived,
  updateNote,
  updateTodo,
  type NotepadData,
} from "@/lib/notepad/service";

/**
 * The personal notepad. Every action resolves the member from the session and
 * the workspace from the slug, then works only on that member's own notes and
 * to-dos (lib/notepad/service.ts scopes every query to them).
 */

const slugSchema = z.string().min(1).max(64);

async function actor(slug: unknown) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  return getWorkspaceForAction(parsed.data, "GUEST", { module: "core" });
}

type Ctx = NonNullable<Awaited<ReturnType<typeof actor>>>;

async function mutate<T>(slug: unknown, fn: (ctx: Ctx) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const ctx = await actor(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  return fn(ctx);
}

export async function loadNotepadAction(slug: string): Promise<NotepadData | null> {
  const ctx = await actor(slug);
  return ctx ? getNotepad(ctx) : null;
}

export async function createNoteAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => createNote(ctx, input));
}

export async function updateNoteAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => updateNote(ctx, input));
}

export async function setNoteArchivedAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => setNoteArchived(ctx, input));
}

export async function deleteNoteAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => deleteNote(ctx, input));
}

export async function createTodoAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => createTodo(ctx, input));
}

export async function updateTodoAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => updateTodo(ctx, input));
}

export async function moveTodoAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => moveTodo(ctx, input));
}

export async function deleteTodoAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => deleteTodo(ctx, input));
}

export async function clearDoneTodosAction(slug: string) {
  return mutate(slug, (ctx) => clearDoneTodos(ctx));
}

export async function sendTodoToTasksAction(slug: string, input: unknown) {
  return mutate(slug, (ctx) => sendTodoToTasks(ctx, input));
}

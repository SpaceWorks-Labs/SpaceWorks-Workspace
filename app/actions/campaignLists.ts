"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import type { ActionResult } from "@/lib/actionResult";
import { createList, deleteList, setListArchived, updateList } from "@/lib/campaigns/lists";
import { adminContext } from "@/lib/campaigns/actionContext";

const refresh = (slug: string) => revalidatePath(`/w/${slug}/campaigns/lists`);

export async function createListAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const a = await adminContext(slug);
  if (a.error) return a.error;
  const result = await createList(a.ctx.workspace.id, a.ctx.user.id, input);
  if (result.ok) refresh(slug);
  return result;
}

export async function updateListAction(slug: string, listId: string, input: unknown): Promise<ActionResult> {
  const a = await adminContext(slug);
  if (a.error) return a.error;
  const result = await updateList(a.ctx.workspace.id, a.ctx.user.id, String(listId), input);
  if (result.ok) refresh(slug);
  return result;
}

export async function archiveListAction(slug: string, listId: string, archived: boolean): Promise<ActionResult> {
  const a = await adminContext(slug);
  if (a.error) return a.error;
  const result = await setListArchived(a.ctx.workspace.id, a.ctx.user.id, String(listId), Boolean(archived));
  if (result.ok) refresh(slug);
  return result;
}

export async function deleteListAction(slug: string, listId: string): Promise<ActionResult> {
  const a = await adminContext(slug);
  if (a.error) return a.error;
  const result = await deleteList(a.ctx.workspace.id, a.ctx.user.id, String(listId));
  if (result.ok) refresh(slug);
  return result;
}

"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import type { ActionResult } from "@/lib/actionResult";
import { addSubscriber, eraseSubscriber, setBlocklisted, setListMembership } from "@/lib/campaigns/subscribers";
import { importFromContacts, importSubscribersCsv, type ImportSummary } from "@/lib/campaigns/import";
import { exportSubscribers } from "@/lib/campaigns/export";
import { adminContext } from "@/lib/campaigns/actionContext";

const refresh = (slug: string) => { revalidatePath(`/w/${slug}/campaigns/subscribers`); revalidatePath(`/w/${slug}/campaigns/lists`); };

export async function addSubscriberAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const a = await adminContext(slug);
  if (a.error) return a.error;
  const result = await addSubscriber(a.ctx.workspace.id, a.ctx.user.id, input);
  if (result.ok) refresh(slug);
  return result;
}

export async function setBlocklistedAction(slug: string, subscriberId: string, blocked: boolean): Promise<ActionResult> {
  const a = await adminContext(slug);
  if (a.error) return a.error;
  const result = await setBlocklisted(a.ctx.workspace.id, a.ctx.user.id, String(subscriberId), Boolean(blocked));
  if (result.ok) refresh(slug);
  return result;
}

export async function setListMembershipAction(slug: string, subscriberId: string, listId: string, on: boolean): Promise<ActionResult> {
  const a = await adminContext(slug);
  if (a.error) return a.error;
  const result = await setListMembership(a.ctx.workspace.id, a.ctx.user.id, String(subscriberId), String(listId), Boolean(on));
  if (result.ok) refresh(slug);
  return result;
}

export async function eraseSubscriberAction(slug: string, subscriberId: string): Promise<ActionResult> {
  const a = await adminContext(slug);
  if (a.error) return a.error;
  const result = await eraseSubscriber(a.ctx.workspace.id, a.ctx.user.id, String(subscriberId));
  if (result.ok) refresh(slug);
  return result;
}

export async function importCsvAction(slug: string, input: unknown): Promise<ActionResult<ImportSummary>> {
  const a = await adminContext(slug, { cost: 5 });
  if (a.error) return a.error;
  const result = await importSubscribersCsv(a.ctx.workspace.id, a.ctx.user.id, input);
  if (result.ok) refresh(slug);
  return result;
}

export async function importContactsAction(slug: string, input: unknown): Promise<ActionResult<ImportSummary>> {
  const a = await adminContext(slug, { cost: 5 });
  if (a.error) return a.error;
  const result = await importFromContacts(a.ctx.workspace.id, a.ctx.user.id, input);
  if (result.ok) refresh(slug);
  return result;
}

export async function exportSubscribersAction(slug: string, listId?: string): Promise<ActionResult<{ content: string; filename: string; count: number }>> {
  const a = await adminContext(slug, { bucket: "dataExport" });
  if (a.error) return a.error;
  return exportSubscribers(a.ctx.workspace.id, a.ctx.user.id, { listId: listId ? String(listId) : undefined });
}

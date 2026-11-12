import "server-only";

import { z } from "zod";
import type { MailingList, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { auditCampaignEvent } from "./audit";
import { slugifyListName } from "./policy";

export const listSchema = z.object({
  name: z.string().trim().min(1, "Enter a list name.").max(80),
  description: z.string().trim().max(500).default(""),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PRIVATE"),
  optIn: z.enum(["SINGLE", "DOUBLE"]).default("DOUBLE"),
});

export type ListWithCounts = MailingList & { confirmed: number; unconfirmed: number; unsubscribed: number };

export async function listLists(workspaceId: string, opts: { includeArchived?: boolean } = {}): Promise<ListWithCounts[]> {
  const lists = await prisma.mailingList.findMany({ where: { workspaceId, ...(opts.includeArchived ? {} : { archivedAt: null }) }, orderBy: { name: "asc" }, take: 500 });
  if (!lists.length) return [];
  const grouped = await prisma.listSubscription.groupBy({ by: ["listId", "status"], where: { workspaceId, listId: { in: lists.map((l) => l.id) } }, _count: { _all: true } });
  const count = (listId: string, status: string) => grouped.find((g) => g.listId === listId && g.status === status)?._count._all ?? 0;
  return lists.map((l) => ({ ...l, confirmed: count(l.id, "CONFIRMED"), unconfirmed: count(l.id, "UNCONFIRMED"), unsubscribed: count(l.id, "UNSUBSCRIBED") }));
}

export async function getList(workspaceId: string, listId: string) {
  return prisma.mailingList.findFirst({ where: { id: listId, workspaceId } });
}

async function uniqueSlug(tx: Prisma.TransactionClient, workspaceId: string, name: string): Promise<string> {
  const base = slugifyListName(name);
  for (let n = 0; n < 50; n++) {
    const slug = n === 0 ? base : `${base}-${n + 1}`;
    if (!(await tx.mailingList.findUnique({ where: { workspaceId_slug: { workspaceId, slug } }, select: { id: true } }))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function createList(workspaceId: string, actorId: string, input: unknown): Promise<ActionResult<{ id: string; slug: string }>> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campaign:list:${workspaceId}`}))`;
    const list = await tx.mailingList.create({ data: { ...parsed.data, description: parsed.data.description || null, workspaceId, slug: await uniqueSlug(tx, workspaceId, parsed.data.name), createdById: actorId } });
    await auditCampaignEvent({ client: tx, workspaceId, actorId, action: "list_created", targetType: "MailingList", targetId: list.id, metadata: { visibility: list.visibility, optIn: list.optIn } });
    return list;
  });
  return { ok: true, data: { id: row.id, slug: row.slug } };
}

export async function updateList(workspaceId: string, actorId: string, listId: string, input: unknown): Promise<ActionResult> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await prisma.mailingList.updateMany({ where: { id: listId, workspaceId }, data: { ...parsed.data, description: parsed.data.description || null } });
  if (!result.count) return actionError("That list no longer exists.");
  await auditCampaignEvent({ workspaceId, actorId, action: "list_updated", targetType: "MailingList", targetId: listId, metadata: { visibility: parsed.data.visibility, optIn: parsed.data.optIn } });
  return { ok: true };
}

export async function setListArchived(workspaceId: string, actorId: string, listId: string, archived: boolean): Promise<ActionResult> {
  const result = await prisma.mailingList.updateMany({ where: { id: listId, workspaceId }, data: { archivedAt: archived ? new Date() : null } });
  if (!result.count) return actionError("That list no longer exists.");
  await auditCampaignEvent({ workspaceId, actorId, action: archived ? "list_archived" : "list_restored", targetType: "MailingList", targetId: listId });
  return { ok: true };
}

/** Delete a list and its subscriptions. A list that a campaign used must be archived instead. */
export async function deleteList(workspaceId: string, actorId: string, listId: string): Promise<ActionResult> {
  const list = await getList(workspaceId, listId);
  if (!list) return actionError("That list no longer exists.");
  if (await prisma.campaignList.count({ where: { listId } })) return actionError("A campaign used this list, so it can't be deleted. Archive it instead.");
  await prisma.$transaction(async (tx) => {
    await tx.mailingList.delete({ where: { id: listId } });
    await auditCampaignEvent({ client: tx, workspaceId, actorId, action: "list_deleted", targetType: "MailingList", targetId: listId });
  });
  return { ok: true };
}

/** Lists that `listIds` may target (same workspace, not archived). */
export async function validListIds(workspaceId: string, listIds: string[]): Promise<string[]> {
  if (!listIds.length) return [];
  const rows = await prisma.mailingList.findMany({ where: { workspaceId, archivedAt: null, id: { in: listIds } }, select: { id: true } });
  return rows.map((r) => r.id);
}

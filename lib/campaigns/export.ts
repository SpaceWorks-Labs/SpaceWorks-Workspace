import "server-only";

import { prisma } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { auditCampaignEvent } from "./audit";

export const MAX_EXPORT_ROWS = 50_000;
const HEADER = ["email", "name", "status", "blocklist_reason", "source", "lists", "created_at"];

/** Subscribers as CSV, formula-neutralised. Optionally one list. Audits the count only. */
export async function exportSubscribers(workspaceId: string, actorId: string, filter: { listId?: string } = {}): Promise<ActionResult<{ content: string; filename: string; count: number }>> {
  const rows = await prisma.subscriber.findMany({
    where: { workspaceId, ...(filter.listId ? { subscriptions: { some: { listId: filter.listId, workspaceId } } } : {}) },
    orderBy: { createdAt: "asc" }, take: MAX_EXPORT_ROWS + 1,
    include: { subscriptions: { where: { status: "CONFIRMED" }, select: { list: { select: { slug: true } } } } },
  });
  if (rows.length > MAX_EXPORT_ROWS) return actionError("That is more than 50,000 subscribers. Export one list at a time.");
  const content = toCsv([HEADER, ...rows.map((s) => [s.email, s.name, s.status.toLowerCase(), s.blocklistReason, s.source, s.subscriptions.map((x) => x.list.slug).join(";"), s.createdAt.toISOString()])]);
  await auditCampaignEvent({ workspaceId, actorId, action: "subscribers_exported", metadata: { count: rows.length } });
  return { ok: true, data: { content, filename: "subscribers.csv", count: rows.length } };
}

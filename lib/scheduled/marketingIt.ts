import "server-only";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { dayInZone, object, path } from "@/lib/marketingIt/schema";
/** Workspace locks plus durable event keys make concurrent beats idempotent. */
export async function run(now: Date) {
 let cursor: string | undefined;
 for (;;) {
  const workspaces = await prisma.workspace.findMany({ where: { status: "ACTIVE", archivedAt: null }, select: { id: true, slug: true, timezone: true, createdAt: true }, orderBy: { id: "asc" }, take: 25, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  if (!workspaces.length) break;
  for (const ws of workspaces) {
   const events = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${ws.id} AND "archivedAt" IS NULL FOR NO KEY UPDATE`;
    if (!await tx.workspace.findFirst({ where: { id: ws.id, status: "ACTIVE", archivedAt: null } })) return [];
    const members = await tx.membership.findMany({ where: { workspaceId: ws.id, status: "ACTIVE", user: { disabledAt: null }, role: { in: ["OWNER", "ADMIN", "MEMBER"] } }, select: { userId: true, role: true } });
    const admins = members.filter(m => m.role !== "MEMBER").map(m => m.userId);
    const rows = await tx.marketingItRecord.findMany({ where: { workspaceId: ws.id, archivedAt: null, kind: { in: ["CONTENT", "PROPOSAL", "REVIEW", "RESTORE"] } } });
    const candidates: Array<{id: string; kind: string; due: string; ownerId: string | null; lead: number}> = [];
    for (const r of rows) {
     if (["PUBLISHED", "WON", "DECLINED", "WITHDRAWN", "COMPLETED"].includes(r.status)) continue;
     const due = r.kind === "CONTENT" ? String(object(r.details).publishAt || "") : r.kind === "RESTORE" ? r.status === "PLANNED" ? r.dateOn?.toISOString() ?? "" : "" : r.dueOn?.toISOString() ?? "";
     if (due) candidates.push({ id: r.id, kind: r.kind, due, ownerId: r.ownerId, lead: r.reminderDays });
    }
    const restores = rows.filter(r => r.kind === "RESTORE" && r.status !== "PLANNED").sort((a, b) => (b.dateOn?.getTime() ?? 0) - (a.dateOn?.getTime() ?? 0));
    const latest = restores[0];
    const baseline = latest?.dueOn ?? new Date(ws.createdAt.getTime() + 90 * 86400000);
    candidates.push({ id: latest?.id ?? ws.id, kind: "RESTORE", due: baseline.toISOString(), ownerId: latest?.ownerId ?? null, lead: latest?.reminderDays ?? 7 });
    const results = [];
    for (const r of candidates) {
     const due = dayInZone(new Date(r.due), r.kind === "CONTENT" ? ws.timezone : "UTC");
     const days = (Date.parse(due) - Date.parse(dayInZone(now, ws.timezone))) / 86400000;
     if (days > r.lead) continue;
     const key = `marketing-it:${r.id}:${r.kind}:${r.due}:${days < 0 ? "overdue" : "due"}`;
     if (await tx.notificationEventRecord.findFirst({ where: { workspaceId: ws.id, dedupeKey: key } })) continue;
     const allowed = r.kind === "CONTENT" ? members.map(m => m.userId) : admins;
     const recipients = r.ownerId && allowed.includes(r.ownerId) ? [r.ownerId] : admins;
     if (!recipients.length) continue;
     const type = r.kind === "CONTENT" ? "marketing.publish_due" : r.kind === "PROPOSAL" ? "marketing.follow_up_due" : r.kind === "REVIEW" ? "it.review_due" : "it.restore_due";
     results.push(await dispatch(ws.id, { type, title: r.kind === "RESTORE" ? "A restore test is due" : r.kind === "CONTENT" ? "Content is due for publishing" : r.kind === "PROPOSAL" ? "An outreach follow-up is due" : "An access review is due", body: "Open the saved record to review the next action.", recipients, useWorkspaceRules: false, dedupeKey: key, url: `${path(ws.slug, r.kind)}${r.id !== ws.id ? `&edit=${r.id}` : ""}`, resource: r.id === ws.id ? undefined : { type: "marketing_it", id: r.id }, data: { recordId: r.id, dueOn: due } }, { tx, now }));
    }
    return results;
   }, { timeout: 30000 });
   for (const event of events) await event.afterCommit();
  }
  cursor = workspaces.at(-1)!.id;
 }
}

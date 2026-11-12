import "server-only";
import { budgetActual } from "@/lib/finance/tools/service";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify/dispatch";
import type { AnyNotificationEvent } from "@/lib/notify/types";
import { eventAlreadySent, memberIdsAtLeast, tryTransactionLock } from "@/lib/approvals/context";

async function once(workspaceId: string, key: string, event: AnyNotificationEvent, mutate?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
 const after = await prisma.$transaction(async tx => {
  if (!await tryTransactionLock(tx, key) || await eventAlreadySent(tx, workspaceId, key)) return null;
  await mutate?.(tx);
  return (await dispatch(workspaceId, { ...event, dedupeKey: key }, { tx })).afterCommit;
 }); await after?.();
}
export async function run(now: Date) {
 const workspaces = await prisma.workspace.findMany({ where: { status: "ACTIVE", archivedAt: null }, select: { id: true, slug: true } });
 for (const ws of workspaces) {
  const admins = await memberIdsAtLeast(prisma, ws.id, "ADMIN");
  const subscriptions = await prisma.subscription.findMany({ where: { workspaceId: ws.id, status: { in: ["ACTIVE", "CANCELLING"] }, nextRenewalAt: { not: null } } });
  for (const s of subscriptions) {
   const renewal = s.nextRenewalAt!;
   const daysLeft = Math.ceil((renewal.getTime() - now.getTime()) / 86400000);
   const offset = [...s.reminderOffsets].sort((a,b) => a-b).find(d => daysLeft <= d);
   if (offset === undefined) continue;
   await once(ws.id, `renewal:${s.id}:${renewal.toISOString()}:${offset}`, { type: "renewal.due", title: "A subscription renewal is due", recipients: s.ownerId ? [s.ownerId, ...admins] : admins, url: `/w/${ws.slug}/subscriptions`, scope: { subscriptionId: s.id }, data: { subscriptionId: s.id, renewsAt: renewal.toISOString(), daysLeft } }, tx => tx.subscription.updateMany({ where: { id: s.id, workspaceId: ws.id }, data: { lastRemindedFor: renewal, lastReminderOffset: offset } }));
  }
  const items = await prisma.vaultItem.findMany({ where: { workspaceId: ws.id, deletedAt: null, rotateEveryDays: { not: null } }, select: { id: true, ownerId: true, rotateEveryDays: true, lastRotatedAt: true, createdAt: true } });
  for (const item of items) {
   const due = new Date((item.lastRotatedAt ?? item.createdAt).getTime() + item.rotateEveryDays! * 86400000);
   if (due > now) continue;
   await once(ws.id, `rotation:${item.id}:${due.toISOString()}`, { type: "vault.rotation_due", title: "A vault item is due for rotation", recipients: [item.ownerId], url: `/w/${ws.slug}/vault`, data: { itemId: item.id, dueAt: due.toISOString() }, useWorkspaceRules: false });
  }
  const maintenance = await prisma.assetMaintenanceLog.findMany({ where: { asset: { workspaceId: ws.id }, nextDueAt: { lte: now } } });
  for (const m of maintenance) await once(ws.id, `maintenance:${m.id}`, { type: "asset.maintenance_due", title: "Equipment maintenance is due", recipients: admins, url: `/w/${ws.slug}/assets`, data: { assetId: m.assetId, dueAt: m.nextDueAt!.toISOString() } });
  const budgets = await prisma.budget.findMany({ where: { workspaceId: ws.id, periodStart: { lte: now }, periodEnd: { gte: now } } });
  for (const b of budgets) {
   const spentMinor = await budgetActual(prisma, b);
   for (const thresholdPct of b.thresholdsPct) if (b.amountMinor > 0 && spentMinor * 100 >= b.amountMinor * thresholdPct) await once(ws.id, `budget:${b.id}:${thresholdPct}`, { type: "budget.threshold", title: "A budget threshold has been reached", recipients: admins, url: `/w/${ws.slug}/requests`, scope: { budgetId: b.id }, data: { budgetId: b.id, thresholdPct, spentMinor, amountMinor: b.amountMinor, currency: b.currency }, useWorkspaceRules: false }, tx => tx.budget.updateMany({ where: { id: b.id, workspaceId: ws.id }, data: { notifiedPct: { push: thresholdPct } } }));
  }
  const gaps = await prisma.serviceCatalogItem.findMany({ where: { workspaceId: ws.id, lifecycle: "ACTIVE", OR: [{ ownerId: null }, { runbookDocId: null }] }, select: { id: true } });
  if (gaps.length) await once(ws.id, `catalogue-gap:${ws.id}:${Math.floor(now.getTime() / 604800000)}`, { type: "catalogue.gap", title: "Some services need an owner or runbook", recipients: admins, url: `/w/${ws.slug}/catalogue`, data: { serviceIds: gaps.map(g => g.id) }, useWorkspaceRules: false });
 }
}

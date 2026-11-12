import "server-only";
import { Prisma, type MarketingItRecord, type WorkspaceRole } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { canManageItAdministration, canManageMarketingOperations, canUseMarketingOperations } from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { recordSchema, detailSchemas, object, path, isMarketing, calendarDays, dayInZone, type Kind } from "./schema";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
export type Actor = { user: { id: string }; workspace: { id: string; slug: string; timezone: string }; membership: { role: WorkspaceRole; viaSuperAdmin?: boolean } };
export class MarketingItError extends Error {}
export const ensure: (value: unknown, message?: string) => asserts value = (value, message = "That record is unavailable. Refresh and try again.") => { if (!value) throw new MarketingItError(message); };
export async function currentActor(actor: Actor, tx: Tx = prisma): Promise<Actor> {
 const found = await activeMemberOrSuperAdmin(tx, actor);
 const membership = found && { role: found.role, ...(found.viaSuperAdmin ? { viaSuperAdmin: true } : {}) };
 ensure(membership && canUseMarketingOperations(membership), "You don't have access to do that.");
 return { ...actor, membership };
}
export async function lock(actor: Actor, tx: Tx) { await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR NO KEY UPDATE`; return currentActor(actor, tx); }
export function canRead(actor: Actor, row: Pick<MarketingItRecord, "kind" | "status" | "ownerId" | "details" | "archivedAt">) {
 if (!canUseMarketingOperations(actor.membership)) return false;
 if (canManageItAdministration(actor.membership)) return true;
 if (row.archivedAt) return false;
 if (row.kind === "CONTENT") return true;
 if (row.kind === "BRAND") return row.status === "APPROVED";
 if (row.kind === "INCIDENT") return object(row.details).confidential === false;
 if (row.kind === "DEVICE") return row.ownerId === actor.user.id;
 if (row.kind === "LICENCE") return (object(row.details).assigneeIds as string[] | undefined)?.includes(actor.user.id) ?? false;
 return false;
}
export function canEdit(actor: Actor, row: Pick<MarketingItRecord, "kind" | "ownerId" | "createdById">) {
 return canManageMarketingOperations(actor.membership) || (canUseMarketingOperations(actor.membership) && row.kind === "CONTENT" && (row.ownerId === actor.user.id || (!row.ownerId && row.createdById === actor.user.id)));
}
/** Asset is authoritative even when another tool records a handover or changes its condition. */
export async function hydrateDevice<T extends MarketingItRecord>(row: T, tx: Tx = prisma): Promise<T> {
 if (row.kind !== "DEVICE") return row;
 const asset = await tx.asset.findFirst({ where: { workspaceId: row.workspaceId, id: row.assetId ?? "" }, select: { ownerUserId: true, serialNumber: true, purchaseDate: true, condition: true, status: true } });
 if (!asset) return { ...row, ownerId: null, archivedAt: row.archivedAt ?? new Date(0) };
 const status = asset.status === "RETIRED" ? "RETIRED" : asset.status === "LOST" ? "LOST" : asset.status === "IN_MAINTENANCE" ? "REPAIR" : asset.ownerUserId ? "ASSIGNED" : ["RETURNED", "IN_STOCK"].includes(row.status) && !row.ownerId ? row.status : "RETURNED";
 return { ...row, ownerId: asset.ownerUserId, status, details: { ...object(row.details), serial: asset.serialNumber ?? "", purchasedOn: asset.purchaseDate?.toISOString().slice(0, 10) ?? "", condition: asset.condition ?? "" } as Prisma.JsonObject };
}
export async function readRecord(actor: Actor, id: string, tx: Tx = prisma) {
 const raw = await tx.marketingItRecord.findFirst({ where: { workspaceId: actor.workspace.id, id } }); ensure(raw);
 const row = await hydrateDevice(raw, tx); ensure(canRead(actor, row)); return row;
}
export async function audit(actor: Actor, tx: Tx, id: string, verb: string) {
 await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: `marketing_it.${verb}`, targetType: "MarketingItRecord", targetId: id, client: tx });
}
export async function sync(actor: Actor, tx: Tx, row: MarketingItRecord, verb: string) {
 await audit(actor, tx, row.id, verb);
 const visible = row.kind === "CONTENT" || (row.kind === "BRAND" && row.status === "APPROVED") || (row.kind === "INCIDENT" && object(row.details).confidential === false);
 if (row.archivedAt) await removeSearchDocument("marketing_it", row.id, tx);
 else await indexSearchDocument({ workspaceId: actor.workspace.id, entityType: "marketing_it", entityId: row.id, title: row.title, url: `${path(actor.workspace.slug, row.kind)}&edit=${row.id}`, visibility: visible ? "WORKSPACE" : "PRIVATE", ownerId: row.createdById }, tx);
 await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, entityType: "marketing_it", entityId: row.id, verb, summary: visible ? `${row.title} ${verb}.` : `IT or outreach record ${verb}.`, visibility: visible ? "WORKSPACE" : "PRIVATE" }, tx);
}
async function member(tx: Tx, workspaceId: string, userId: string, admin = false) {
 ensure(await tx.membership.findFirst({ where: { workspaceId, userId, status: "ACTIVE", user: { disabledAt: null }, role: { in: admin ? ["OWNER", "ADMIN"] : ["OWNER", "ADMIN", "MEMBER"] } } }), "Choose an active person in this workspace.");
}
export async function saveRecord(supplied: Actor, raw: unknown) {
 const v = recordSchema.parse(raw);
 return prisma.$transaction(async tx => {
  const actor = await lock(supplied, tx), workspaceId = actor.workspace.id;
  const old = v.id ? await readRecord(actor, v.id, tx) : null;
  ensure(!old || (!old.archivedAt && !old.completedAt && old.kind === v.kind), "Archived or completed records stay locked.");
  ensure(canEdit(actor, old ?? { kind: v.kind, ownerId: actor.user.id, createdById: actor.user.id }), "You don't have access to edit this record.");
  if (!canManageMarketingOperations(actor.membership)) ensure(!v.ownerId || v.ownerId === actor.user.id, "Assign your content to yourself or ask an admin.");
  if (v.ownerId) await member(tx, workspaceId, v.ownerId, !["CONTENT", "DEVICE"].includes(v.kind));
  ensure(v.kind === "DEVICE" || !v.assetId, "Only device records link an asset.");
  ensure(v.kind === "LICENCE" || !v.subscriptionId, "Only licence records link a subscription.");
  const details = detailSchemas[v.kind].parse(v.details) as Prisma.InputJsonObject;
  if (v.kind === "BRAND" && v.status === "APPROVED" && ["LOGO", "PHOTO", "TEMPLATE"].includes(String(details.category))) {
   ensure(old && await tx.marketingItAttachment.count({ where: { workspaceId, recordId: old.id, file: { deletedAt: null } } }), "Save as draft, attach the asset, then mark it approved.");
  }
  if (v.kind === "DEVICE") {
   ensure(!old || old.assetId === v.assetId, "Keep the original asset linked to its handover history.");
   await tx.$queryRaw`SELECT id FROM "Asset" WHERE "workspaceId"=${workspaceId} AND id=${v.assetId} FOR UPDATE`;
   const asset = await tx.asset.findFirst({ where: { workspaceId, id: v.assetId } }); ensure(asset, "Choose an asset in this workspace.");
   ensure(asset.status === "RETIRED" ? v.status === "RETIRED" : asset.status !== "LOST" || ["LOST", "RETIRED"].includes(v.status), "Use Assets to review a lost or retired asset before assigning it.");
   if (v.status === "RETIRED" && !await tx.moneyControlRecord.findFirst({ where: { workspaceId, assetId: asset.id, kind: "DISPOSAL", status: "POSTED" } })) ensure(!await tx.moneyControlRecord.findFirst({ where: { workspaceId, assetId: asset.id, kind: "SCHEDULE", status: "ACTIVE" } }), "Record this asset’s disposal in Money controls first.");
   await tx.asset.updateMany({ where: { workspaceId, id: asset.id }, data: { status: v.status === "RETIRED" ? "RETIRED" : v.status === "LOST" ? "LOST" : v.status === "REPAIR" ? "IN_MAINTENANCE" : "AVAILABLE", ownerUserId: v.ownerId || null, serialNumber: String(details.serial) || null, purchaseDate: details.purchasedOn ? new Date(String(details.purchasedOn)) : null, condition: String(details.condition) || null } });
  }
  if (v.kind === "LICENCE") {
   ensure(!old || old.subscriptionId === v.subscriptionId, "Keep the original subscription linked to this register.");
   ensure(await tx.subscription.findFirst({ where: { workspaceId, id: v.subscriptionId, kind: "LICENSE" } }), "Choose a licence subscription in this workspace.");
   for (const userId of details.assigneeIds as string[]) await member(tx, workspaceId, userId);
   if (v.status === "RETIRED") ensure(!(details.assigneeIds as string[]).length, "Remove seat assignments before retiring this licence.");
  }
  if (v.kind === "CONTENT" && details.socialPostId) {
   ensure(v.status === "PUBLISHED", "Link the social post after publishing.");
   const post = await tx.socialPost.findFirst({ where: { workspaceId, id: String(details.socialPostId) }, select: { account: { select: { platform: true } } } });
   ensure(post && post.account.platform === details.channel, "Choose a published post for the same channel in this workspace.");
  }
  if (v.kind === "PROPOSAL") {
   if (details.contactId) ensure(await tx.contact.findFirst({ where: { workspaceId, id: String(details.contactId), deletedAt: null } }), "Choose an accessible contact.");
   if (details.organisationId) ensure(await tx.organisation.findFirst({ where: { workspaceId, id: String(details.organisationId), deletedAt: null } }), "Choose an accessible organisation.");
   if (details.dealId) ensure(await tx.deal.findFirst({ where: { workspaceId, id: String(details.dealId), ...(details.organisationId ? { organisationId: String(details.organisationId) } : {}) } }), "Choose a deal for the linked organisation.");
   if (details.fundingId) ensure(await tx.fundingRecord.findFirst({ where: { workspaceId, id: String(details.fundingId), archivedAt: null } }), "Choose a funding record in this workspace.");
  }
  if (v.kind === "INCIDENT") {
   if (details.deviceId) ensure(await tx.asset.findFirst({ where: { workspaceId, id: String(details.deviceId) } }));
   if (details.accountId) ensure(await tx.socialAccount.findFirst({ where: { workspaceId, id: String(details.accountId) } }));
   if (details.integrationId) ensure(await tx.integrationConnection.findFirst({ where: { workspaceId, id: String(details.integrationId) } }));
   if (details.serviceIncidentId) ensure(await tx.incident.findFirst({ where: { workspaceId, id: String(details.serviceIncidentId) } }));
  }
  if (v.kind === "RESTORE") {
   if (details.runbookDocId) ensure(await tx.doc.findFirst({ where: { workspaceId, id: String(details.runbookDocId), archivedAt: null } }));
   if (details.backupRunId) ensure(await tx.backupRun.findFirst({ where: { workspaceId, id: String(details.backupRunId) } }));
   if (v.status !== "PLANNED") ensure(details.result && v.notes, "Record the result and recovery notes.");
  }
  if (v.kind === "REVIEW") ensure(v.status === "OPEN", "Complete a review after deciding every saved access item.");
  const data = { title: v.title, status: v.status, ownerId: v.ownerId || null, assetId: v.assetId || null, subscriptionId: v.subscriptionId || null, dateOn: v.dateOn ? new Date(v.dateOn) : null, dueOn: v.kind === "CONTENT" && details.publishAt ? new Date(dayInZone(new Date(String(details.publishAt)), actor.workspace.timezone)) : v.dueOn ? new Date(v.dueOn) : null, reminderDays: v.reminderDays, notes: v.notes, details };
  const row = old ? await tx.marketingItRecord.update({ where: { workspaceId_id: { workspaceId, id: old.id } }, data }) : await tx.marketingItRecord.create({ data: { ...data, workspaceId, kind: v.kind, createdById: actor.user.id } });
  if (row.kind === "DEVICE" && (!old || old.ownerId !== row.ownerId || old.status !== row.status)) await tx.marketingItEvent.create({ data: { workspaceId, recordId: row.id, actorId: actor.user.id, action: row.ownerId ? "HANDOVER" : row.status === "LOST" ? "LOSS_RECORDED" : row.status === "RETIRED" ? "RETIRED" : old?.ownerId ? "RETURN" : "REGISTERED", note: String(details.handoverNote), data: { from: old?.ownerId ?? null, to: row.ownerId, status: row.status } } });
  if (row.kind === "REVIEW" && !old) { const { snapshotReview } = await import("./reviews"); await snapshotReview(actor, tx, row.id); }
  await sync(actor, tx, row, old ? "updated" : "created"); return { id: row.id };
 }, { timeout: 30000 });
}
export async function archiveRecord(supplied: Actor, id: string, archived: boolean) {
 return prisma.$transaction(async tx => {
  const actor = await lock(supplied, tx), row = await readRecord(actor, id, tx);
  ensure(canEdit(actor, row) && !row.completedAt, "This record is read-only.");
  if (archived && ["DEVICE", "LICENCE"].includes(row.kind)) ensure(row.kind === "DEVICE" ? !row.ownerId : !(object(row.details).assigneeIds as string[] | undefined)?.length, "Return devices and release licence seats before archiving.");
  const changed = await tx.marketingItRecord.update({ where: { workspaceId_id: { workspaceId: actor.workspace.id, id } }, data: { archivedAt: archived ? new Date() : null } }); await sync(actor, tx, changed, archived ? "archived" : "restored"); return { id };
 });
}
export type Filters = { q?: string; status?: string; owner?: string; overdue?: string; archived?: string; page?: string; view?: string; date?: string; channel?: string; tag?: string };
export function recordsWhere(actor: Actor, kind: Kind, filters: Filters): Prisma.MarketingItRecordWhereInput {
 const read: Prisma.MarketingItRecordWhereInput = canManageItAdministration(actor.membership) ? {} : kind === "CONTENT" ? {} : kind === "BRAND" ? { status: "APPROVED" } : kind === "INCIDENT" ? { details: { path: ["confidential"], equals: false } } : kind === "DEVICE" ? {} : kind === "LICENCE" ? { details: { path: ["assigneeIds"], array_contains: [actor.user.id] } } : { id: "" };
 return { AND: [{ workspaceId: actor.workspace.id, kind, archivedAt: filters.archived === "1" && canManageItAdministration(actor.membership) ? { not: null } : null }, read,
  ...(filters.q ? [{ title: { contains: filters.q.slice(0, 200), mode: "insensitive" as const } }] : []), ...(filters.status && kind !== "DEVICE" ? [{ status: filters.status.slice(0, 30) }] : []), ...(filters.owner && kind !== "DEVICE" ? [{ ownerId: filters.owner.slice(0, 100) }] : []), ...(filters.overdue === "1" ? [{ dueOn: { lt: new Date() }, status: { notIn: ["PUBLISHED", "WON", "DECLINED", "RESOLVED", "COMPLETED", "RETIRED"] } }] : []), ...(filters.channel && kind === "CONTENT" ? [{ details: { path: ["channel"], equals: filters.channel } }] : []), ...(filters.tag && kind === "BRAND" ? [{ details: { path: ["tags"], string_contains: filters.tag.slice(0, 100) } }] : [])] };
}
export async function listWhere(actor: Actor, kind: Kind, filters: Filters) {
 const where = recordsWhere(actor, kind, filters);
 if (kind === "DEVICE" && (!canManageItAdministration(actor.membership) || filters.owner || filters.status)) {
  const clauses: Prisma.AssetWhereInput[] = [];
  if (!canManageItAdministration(actor.membership)) clauses.push({ ownerUserId: actor.user.id });
  if (filters.owner) clauses.push({ ownerUserId: filters.owner.slice(0, 100) });
  if (filters.status) {
   const state = filters.status;
   clauses.push(state === "ASSIGNED" ? { status: "AVAILABLE", ownerUserId: { not: null } } : ["IN_STOCK", "RETURNED"].includes(state) ? { status: "AVAILABLE", ownerUserId: null } : state === "REPAIR" ? { status: "IN_MAINTENANCE" } : state === "LOST" ? { status: "LOST" } : state === "RETIRED" ? { status: "RETIRED" } : { id: "" });
  }
  const assets = await prisma.asset.findMany({ where: { workspaceId: actor.workspace.id, AND: clauses }, select: { id: true } });
  const extra: Prisma.MarketingItRecordWhereInput[] = [{ assetId: { in: assets.map(a => a.id) } }];
  if (filters.status === "IN_STOCK") extra.push({ status: "IN_STOCK", ownerId: null });
  if (filters.status === "RETURNED") extra.push({ NOT: { status: "IN_STOCK", ownerId: null } });
  where.AND = [...(Array.isArray(where.AND) ? where.AND : [where.AND ?? {}]), ...extra];
 }
 return where;
}
export async function loadTools(supplied: Actor, kind: Kind, filters: Filters, edit?: string) {
 const actor = await currentActor(supplied), workspaceId = actor.workspace.id, admin = canManageItAdministration(actor.membership), where = await listWhere(actor, kind, filters);
 const page = Math.max(1, Math.min(10000, Number.parseInt(filters.page ?? "1", 10) || 1));
 const calendarView = kind === "CONTENT" && ["month", "week"].includes(filters.view ?? "");
 if (calendarView) {
  const days = calendarDays(filters.date ?? dayInZone(new Date(), actor.workspace.timezone), filters.view!);
  where.AND = [...(Array.isArray(where.AND) ? where.AND : [where.AND ?? {}]), { dueOn: { gte: new Date(days[0]!), lte: new Date(days.at(-1)!) } }];
 }
 const [records, total, people, selected, assets, subscriptions, contacts, organisations, deals, funding, posts, accounts, docs, incidents, backups, integrations, latestRestore, instanceBackupHealth] = await Promise.all([
  prisma.marketingItRecord.findMany({ where, orderBy: [{ dueOn: "asc" }, { createdAt: "desc" }, { id: "asc" }], take: calendarView ? 1000 : 30, skip: calendarView ? 0 : (page - 1) * 30 }), prisma.marketingItRecord.count({ where }),
  prisma.membership.findMany({ where: { workspaceId }, select: { user: { select: { id: true, name: true } }, role: true, status: true } }),
  edit ? prisma.marketingItRecord.findFirst({ where: { workspaceId, kind, id: edit.slice(0, 100) }, include: { attachments: { where: { file: { deletedAt: null } }, select: { file: { select: { id: true, filename: true, contentType: true, size: true } } } }, events: { orderBy: { createdAt: "desc" }, take: 100 }, reviewItems: { orderBy: [{ userId: "asc" }, { sourceType: "asc" }, { id: "asc" }] } } }) : null,
  admin ? prisma.asset.findMany({ where: { workspaceId }, select: { id: true, name: true, serialNumber: true, purchaseDate: true, condition: true, ownerUserId: true } }) : [],
  admin ? prisma.subscription.findMany({ where: { workspaceId, kind: "LICENSE" }, select: { id: true, name: true, nextRenewalAt: true, status: true } }) : [],
  admin ? prisma.contact.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, displayName: true } }) : [],
  admin ? prisma.organisation.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, name: true } }) : [],
  admin ? prisma.deal.findMany({ where: { workspaceId }, select: { id: true, title: true } }) : [],
  admin ? prisma.fundingRecord.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, title: true, kind: true } }) : [],
  kind === "CONTENT" ? prisma.socialPost.findMany({ where: { workspaceId }, select: { id: true, text: true, accountId: true }, orderBy: { publishedAt: "desc" }, take: 500 }) : [],
  admin ? prisma.socialAccount.findMany({ where: { workspaceId }, select: { id: true, displayName: true } }) : [],
  admin ? prisma.doc.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, title: true } }) : [],
  admin ? prisma.incident.findMany({ where: { workspaceId }, select: { id: true, title: true, number: true }, take: 500 }) : [],
  admin && kind === "RESTORE" ? prisma.backupRun.findMany({ where: { workspaceId }, select: { id: true, kind: true, status: true, startedAt: true, finishedAt: true }, orderBy: { startedAt: "desc" }, take: 30 }) : [],
  admin ? prisma.integrationConnection.findMany({ where: { workspaceId }, select: { id: true, accountLabel: true, provider: true } }) : [],
  admin && kind === "RESTORE" ? prisma.marketingItRecord.findFirst({ where: { workspaceId, kind: "RESTORE", archivedAt: null, status: { in: ["PASSED", "FAILED"] } }, select: { id: true, dueOn: true, dateOn: true, status: true }, orderBy: [{ dateOn: "desc" }, { createdAt: "desc" }] }) : null,
  admin && kind === "RESTORE" ? prisma.backupRun.findMany({ where: { workspaceId: null }, select: { kind: true, status: true, startedAt: true, finishedAt: true }, orderBy: { startedAt: "desc" }, take: 30 }) : [],
 ]);
 const hydrated = selected ? await hydrateDevice(selected) : null;
 const readable = hydrated && canRead(actor, hydrated) ? hydrated : null;
 const currentRecords = await Promise.all(records.map(r => hydrateDevice(r)));
 if (readable) {
  const { findDownloadableFile } = await import("@/lib/files");
  const permitted = await Promise.all(readable.attachments.map(async a => Boolean(await findDownloadableFile(a.file.id, actor.user.id))));
  readable.attachments = readable.attachments.filter((_, index) => permitted[index]);
 }
 const { maxUploadBytes } = await import("@/lib/storage");
 const { libraryWhere } = await import("@/lib/files/service");
 const libraryFiles = isMarketing(kind) ? await prisma.fileObject.findMany({ where: { AND: [await libraryWhere({ ...actor, user: { id: actor.user.id, name: null } }), { docId: null, taskId: null }] }, select: { id: true, filename: true }, orderBy: { createdAt: "desc" }, take: 300 }) : [];
 return { records: currentRecords, total, page, selected: readable, people, assets, subscriptions, contacts, organisations, deals, funding, posts, accounts, docs, incidents, backups, integrations, latestRestore, instanceBackupHealth, libraryFiles, uploadMaxBytes: maxUploadBytes(), admin, userId: actor.user.id, editable: readable ? canEdit(actor, readable) && !readable.completedAt && !readable.archivedAt : false };
}
export type ToolData = Awaited<ReturnType<typeof loadTools>>;

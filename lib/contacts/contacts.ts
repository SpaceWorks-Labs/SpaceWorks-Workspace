import "server-only";
import { z } from "zod";
import type { Prisma, Visibility } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { canManageContacts, canViewContacts } from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { dispatch } from "@/lib/notify/dispatch";
import { idSchema } from "@/lib/validation";
import { userTeamIds, hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { isActiveMember, type PeopleActor } from "@/lib/people/context";
import { blocklistSubscribersForContacts } from "@/lib/campaigns/blocklist";
import { duplicateContacts, duplicateOrganisations, normalizeDomain, exportCsv, exportVCard, parseCsv } from "./formats";

export const STAGES = ["Prospect", "Qualified", "Proposal", "Negotiation", "Won", "Lost"] as const;
export const ORG_KINDS = ["SPONSOR", "PARTNER", "VENDOR", "VENUE", "UNIVERSITY", "GOVERNMENT", "MEDIA", "COMMUNITY", "DONOR", "OTHER"] as const;
const optionalText = (max: number) => z.string().trim().max(max).default("");
const accessSchema = { ownerId: idSchema.nullable().default(null), teamId: idSchema.nullable().default(null), visibility: z.enum(["WORKSPACE", "TEAM", "PRIVATE"]).default("WORKSPACE"), tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30).default([]), notesMd: optionalText(8000) };
export const contactSchema = z.object({ displayName: z.string().trim().min(1).max(160), email: z.union([z.email().max(250), z.literal("")]).default(""), phone: optionalText(60), sensitivePhone: z.boolean().default(false), kinds: z.array(z.string().trim().min(1).max(40)).max(20).default([]), organisationId: idSchema.nullable().default(null), nextFollowUpAt: z.iso.datetime().nullable().default(null), doNotContact: z.boolean().default(false), ...accessSchema });
export const organisationSchema = z.object({ name: z.string().trim().min(1).max(160), kinds: z.array(z.enum(ORG_KINDS)).max(10).default([]), website: z.union([z.url().refine(v => /^https?:\/\//.test(v), "Use an http or https website."), z.literal("")]).default(""), address: optionalText(1000), status: z.enum(["PROSPECT", "ACTIVE", "DORMANT", "DO_NOT_CONTACT"]).default("ACTIVE"), ...accessSchema });
const jsonArray = (value: unknown) => Array.isArray(value) ? value.filter(v => v && typeof v === "object") as Array<Record<string, unknown>> : [];
export function contactChannels(row: { emails: unknown; phones: unknown }) {
  return { email: jsonArray(row.emails).find(v => typeof v.value === "string")?.value as string | undefined ?? "", phone: jsonArray(row.phones).find(v => typeof v.e164 === "string")?.e164 as string | undefined ?? "" };
}
async function visibleWhere(actor: PeopleActor) {
  // Callers spread this and add `id`, so the deny filter must not be an `id` key they can overwrite.
  if (!canViewContacts(actor.membership)) return { workspaceId: actor.workspace.id, AND: [{ id: { in: [] as string[] } }] };
  const base = { workspaceId: actor.workspace.id, deletedAt: null };
  if (canManageContacts(actor.membership)) return base;
  const teamIds = await userTeamIds(actor.workspace.id, actor.user.id);
  const hidden = await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role });
  return { ...base, AND: [teamScopeFilter(hidden), { OR: [{ visibility: "WORKSPACE" as Visibility }, { ownerId: actor.user.id }, { createdById: actor.user.id }, { visibility: "TEAM" as Visibility, teamId: { in: teamIds } }] }] };
}
function canEdit(actor: PeopleActor, row: { ownerId: string | null; createdById: string | null }) { return canManageContacts(actor.membership) || canViewContacts(actor.membership) && (row.ownerId === actor.user.id || row.createdById === actor.user.id); }
async function validAccess(actor: PeopleActor, data: { ownerId: string | null; teamId: string | null; visibility: string }) {
  if (data.ownerId && (!await isActiveMember(actor.workspace.id, data.ownerId) || !canManageContacts(actor.membership) && data.ownerId !== actor.user.id)) return false;
  if (data.visibility === "TEAM" && !data.teamId) return false;
  if (data.teamId) {
    const hidden = await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role });
    const team = await prisma.team.findFirst({ where: { workspaceId: actor.workspace.id, id: data.teamId, archivedAt: null, ...(!canManageContacts(actor.membership) && data.visibility === "TEAM" ? { members: { some: { userId: actor.user.id } } } : {}) }, select: { id: true } });
    if (!team || hidden.includes(team.id)) return false;
  }
  return true;
}
function redactContact<T extends { phones: Prisma.JsonValue; ownerId: string | null; createdById: string | null }>(actor: PeopleActor, c: T) {
  return { ...c, phones: (canEdit(actor, c) ? c.phones : jsonArray(c.phones).filter(p => !p.sensitive)) as Prisma.JsonValue };
}
export async function listContacts(actor: PeopleActor, q = "") {
  const rows = await prisma.contact.findMany({ where: { ...await visibleWhere(actor), ...(q ? { OR: [{ displayName: { contains: q.slice(0, 100), mode: "insensitive" } }, { tags: { has: q.toLowerCase().slice(0, 40) } }] } : {}) }, orderBy: { displayName: "asc" }, take: 1000 });
  return rows.map(c => redactContact(actor, c));
}
export async function listOrganisations(actor: PeopleActor, q = "") {
  return prisma.organisation.findMany({ where: { ...await visibleWhere(actor), ...(q ? { name: { contains: q.slice(0, 100), mode: "insensitive" } } : {}) }, orderBy: { name: "asc" }, take: 1000 });
}
export async function getContact(actor: PeopleActor, id: string) {
  const row = await prisma.contact.findFirst({ where: { ...await visibleWhere(actor), id } });
  if (!row) return null;
  const orgs = await listOrganisations(actor);
  const roles = await prisma.contactOrgRole.findMany({ where: { contactId: row.id, contact: { workspaceId: actor.workspace.id }, organisation: { workspaceId: actor.workspace.id, id: { in: orgs.map(o => o.id) } } }, select: { title: true, organisationId: true } });
  const interactions = await prisma.contactInteraction.findMany({ where: { workspaceId: actor.workspace.id, contactId: row.id, OR: [{ organisationId: null }, { organisationId: { in: orgs.map(o => o.id) } }] }, orderBy: { occurredAt: "desc" }, take: 100 });
  const links = await visibleLinks(actor, "contact", row.id);
  return { ...redactContact(actor, row), organisations: roles.map(r => ({ ...r, name: orgs.find(o => o.id === r.organisationId)!.name })), interactions, links, editable: canEdit(actor, row) };
}
export async function getOrganisation(actor: PeopleActor, id: string) {
  const row = await prisma.organisation.findFirst({ where: { ...await visibleWhere(actor), id } }); if (!row) return null;
  const contacts = await listContacts(actor);
  const roles = await prisma.contactOrgRole.findMany({ where: { organisationId: row.id, organisation: { workspaceId: actor.workspace.id }, contact: { workspaceId: actor.workspace.id, id: { in: contacts.map(c => c.id) } } }, select: { contactId: true, title: true } });
  const interactions = await prisma.contactInteraction.findMany({ where: { workspaceId: actor.workspace.id, organisationId: row.id, OR: [{ contactId: null }, { contactId: { in: contacts.map(c => c.id) } }] }, orderBy: { occurredAt: "desc" }, take: 100 });
  return { ...row, contacts: roles.map(r => ({ ...r, name: contacts.find(c => c.id === r.contactId)!.displayName })), interactions, links: await visibleLinks(actor, "organisation", id), editable: canEdit(actor, row) };
}
async function audit(tx: Prisma.TransactionClient, actor: PeopleActor, action: string, type: string, id: string) { await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: `contacts.${action}`, targetType: type, targetId: id }); }
async function index(tx: Prisma.TransactionClient, actor: PeopleActor, type: "contact" | "organisation", row: { id: string; ownerId: string | null; createdById: string | null; teamId: string | null; visibility: Visibility; tags: string[] }, title: string) {
  // No contact channels or notes enter search. Guests cannot read CRM: use PRIVATE
  // entries for the owner until the shared search reader gains a CRM role gate.
  await indexSearchDocument({ workspaceId: actor.workspace.id, entityType: type, entityId: row.id, title, body: row.tags.join(" "), visibility: "PRIVATE", ownerId: row.ownerId ?? row.createdById, teamId: row.teamId, url: `/w/${actor.workspace.slug}/contacts/${type === "organisation" ? "organisations/" : ""}${row.id}` }, tx);
}
export async function saveContact(actor: PeopleActor, input: unknown, id: string | null = null): Promise<ActionResult<{ id: string; duplicates?: string[] }>> {
  if (!canViewContacts(actor.membership)) return actionError(NOT_ALLOWED);
  const p = contactSchema.safeParse(input); if (!p.success) return validationError(p.error);
  if (!await validAccess(actor, p.data)) return actionError(NOT_ALLOWED);
  const old = id ? await prisma.contact.findFirst({ where: { ...await visibleWhere(actor), id } }) : null;
  if (id && (!old || !canEdit(actor, old))) return actionError(NOT_ALLOWED);
  if (p.data.organisationId && !await prisma.organisation.findFirst({ where: { ...await visibleWhere(actor), id: p.data.organisationId } })) return actionError("Pick an organisation you can view.");
  const { email, phone, sensitivePhone, organisationId, nextFollowUpAt, ...fields } = p.data;
  const duplicates = duplicateContacts({ displayName: fields.displayName, email, phone }, (await listContacts(actor)).filter(c => c.id !== id).map(c => ({ id: c.id, displayName: c.displayName, ...contactChannels(c) }))).map(c => c.id);
  const row = await prisma.$transaction(async tx => {
    const data = { ...fields, ownerId: fields.ownerId ?? actor.user.id, emails: email ? [{ type: "work", value: email.toLowerCase(), primary: true }] : [], phones: phone ? [{ type: "work", e164: phone, sensitive: sensitivePhone }] : [], nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null };
    const row = old ? await tx.contact.update({ where: { id: old.id, workspaceId: actor.workspace.id }, data }) : await tx.contact.create({ data: { ...data, workspaceId: actor.workspace.id, createdById: actor.user.id } });
    if (organisationId) await tx.contactOrgRole.upsert({ where: { contactId_organisationId: { contactId: row.id, organisationId } }, create: { contactId: row.id, organisationId, isPrimary: true }, update: {} });
    if (row.doNotContact) await blocklistSubscribersForContacts(tx, actor.workspace.id, [row.id]);
    await audit(tx, actor, old ? "updated" : "created", "Contact", row.id); await index(tx, actor, "contact", row, row.displayName);
    await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: old ? "updated" : "created", entityType: "contact", entityId: row.id, summary: "Updated a relationship contact", visibility: "PRIVATE" }, tx);
    return row;
  }); return { ok: true, data: { id: row.id, duplicates } };
}
export async function saveOrganisation(actor: PeopleActor, input: unknown, id: string | null = null): Promise<ActionResult<{ id: string; duplicates: string[] }>> {
  if (!canViewContacts(actor.membership)) return actionError(NOT_ALLOWED);
  const p = organisationSchema.safeParse(input); if (!p.success) return validationError(p.error);
  if (!await validAccess(actor, p.data)) return actionError(NOT_ALLOWED);
  const old = id ? await prisma.organisation.findFirst({ where: { ...await visibleWhere(actor), id } }) : null;
  if (id && (!old || !canEdit(actor, old))) return actionError(NOT_ALLOWED);
  const duplicates = duplicateOrganisations(p.data, (await listOrganisations(actor)).filter(o => o.id !== id)).map(o => o.id);
  const row = await prisma.$transaction(async tx => {
    const data = { ...p.data, ownerId: p.data.ownerId ?? actor.user.id, website: p.data.website || null, domain: p.data.website ? normalizeDomain(p.data.website) : null };
    const row = old ? await tx.organisation.update({ where: { id: old.id, workspaceId: actor.workspace.id }, data }) : await tx.organisation.create({ data: { ...data, workspaceId: actor.workspace.id, createdById: actor.user.id } });
    await audit(tx, actor, "organisation_saved", "Organisation", row.id); await index(tx, actor, "organisation", row, row.name);
    await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: old ? "updated" : "created", entityType: "organisation", entityId: row.id, summary: "Updated a community organisation", visibility: "PRIVATE" }, tx);
    return row;
  }); return { ok: true, data: { id: row.id, duplicates } };
}
export async function deleteRelationship(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  if (!canManageContacts(actor.membership)) return actionError(NOT_ALLOWED);
  const p = z.object({ type: z.enum(["contact", "organisation"]), id: idSchema }).safeParse(input); if (!p.success) return validationError(p.error);
  await prisma.$transaction(async tx => {
    const where = { workspaceId: actor.workspace.id, id: p.data.id, deletedAt: null };
    const row = p.data.type === "contact" ? await tx.contact.updateMany({ where, data: { deletedAt: new Date() } }) : await tx.organisation.updateMany({ where, data: { deletedAt: new Date() } });
    if (row.count) { if (p.data.type === "contact") await blocklistSubscribersForContacts(tx, actor.workspace.id, [p.data.id]); await removeSearchDocument(p.data.type, p.data.id, tx); await audit(tx, actor, "deleted", p.data.type, p.data.id); }
  }); return { ok: true };
}
export async function addInteraction(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const p = z.object({ contactId: idSchema.nullable().default(null), organisationId: idSchema.nullable().default(null), type: z.enum(["CALL", "MEETING", "EMAIL", "MESSAGE", "EVENT", "NOTE", "INTRO"]), summary: z.string().trim().min(1).max(300), bodyMd: optionalText(5000), occurredAt: z.iso.datetime() }).refine(v => v.contactId || v.organisationId).safeParse(input);
  if (!p.success) return validationError(p.error);
  const c = p.data.contactId ? await getContact(actor, p.data.contactId) : null; const o = p.data.organisationId ? await getOrganisation(actor, p.data.organisationId) : null;
  if (!canViewContacts(actor.membership) || p.data.contactId && !c?.editable || p.data.organisationId && !o?.editable) return actionError(NOT_ALLOWED);
  await prisma.$transaction(async tx => {
    const row = await tx.contactInteraction.create({ data: { ...p.data, occurredAt: new Date(p.data.occurredAt), workspaceId: actor.workspace.id, byUserId: actor.user.id } });
    // Out-of-order interaction imports must not move the latest interaction backwards.
    for (const [type, id] of [["contact", p.data.contactId], ["organisation", p.data.organisationId]] as const) if (id) {
      const where = { id, workspaceId: actor.workspace.id, OR: [{ lastInteractionAt: null }, { lastInteractionAt: { lt: new Date(p.data.occurredAt) } }] };
      if (type === "contact") await tx.contact.updateMany({ where, data: { lastInteractionAt: new Date(p.data.occurredAt) } }); else await tx.organisation.updateMany({ where, data: { lastInteractionAt: new Date(p.data.occurredAt) } });
    }
    await audit(tx, actor, "interaction_added", "ContactInteraction", row.id);
  }); return { ok: true };
}
async function targetVisible(actor: PeopleActor, type: string, id: string) {
  if (type === "contact") return Boolean(await prisma.contact.findFirst({ where: { ...await visibleWhere(actor), id }, select: { id: true } }));
  if (type === "organisation") return Boolean(await prisma.organisation.findFirst({ where: { ...await visibleWhere(actor), id }, select: { id: true } }));
  if (type === "project") return Boolean(await prisma.project.findFirst({ where: { workspaceId: actor.workspace.id, id, ...teamScopeFilter(await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role })) }, select: { id: true } }));
  return false;
}
async function visibleLinks(actor: PeopleActor, fromType: string, fromId: string) {
  const rows = await prisma.recordLink.findMany({ where: { workspaceId: actor.workspace.id, fromType, fromId }, take: 100 });
  const visible = await Promise.all(rows.map(async r => await targetVisible(actor, r.toType, r.toId) ? r : null));
  return visible.filter((r): r is NonNullable<typeof r> => r !== null);
}
export async function linkRecord(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const p = z.object({ fromType: z.enum(["contact", "organisation"]), fromId: idSchema, toType: z.enum(["contact", "organisation", "project"]), toId: idSchema, label: optionalText(100) }).safeParse(input); if (!p.success) return validationError(p.error);
  const from = p.data.fromType === "contact" ? await getContact(actor, p.data.fromId) : await getOrganisation(actor, p.data.fromId);
  if (!from?.editable || !await targetVisible(actor, p.data.toType, p.data.toId)) return actionError(NOT_ALLOWED);
  await prisma.$transaction(async tx => {
    await tx.recordLink.upsert({ where: { workspaceId_fromType_fromId_toType_toId: { workspaceId: actor.workspace.id, fromType: p.data.fromType, fromId: p.data.fromId, toType: p.data.toType, toId: p.data.toId } }, create: { ...p.data, workspaceId: actor.workspace.id, createdById: actor.user.id }, update: { label: p.data.label } });
    await audit(tx, actor, "record_linked", p.data.fromType, p.data.fromId);
  }); return { ok: true };
}
export async function listDeals(actor: PeopleActor) {
  const organisations = await listOrganisations(actor);
  return prisma.deal.findMany({ where: { workspaceId: actor.workspace.id, organisationId: { in: organisations.map(o => o.id) } }, include: { organisation: { select: { name: true, ownerId: true, createdById: true } } }, orderBy: { updatedAt: "desc" }, take: 1000 });
}
export async function saveDeal(actor: PeopleActor, input: unknown, id: string | null = null): Promise<ActionResult> {
  if (!canViewContacts(actor.membership)) return actionError(NOT_ALLOWED);
  const p = z.object({ organisationId: idSchema, title: z.string().trim().min(1).max(160), type: z.enum(["SPONSORSHIP", "PARTNERSHIP", "GRANT", "IN_KIND", "VENUE"]), stage: z.enum(STAGES), amountMinor: z.number().int().min(0).max(2147483647).nullable().default(null), currency: z.string().regex(/^[A-Z]{3}$/).default("INR"), ownerId: idSchema.nullable().default(null) }).safeParse(input); if (!p.success) return validationError(p.error);
  const org = await getOrganisation(actor, p.data.organisationId); if (!org?.editable || p.data.ownerId && !await isActiveMember(actor.workspace.id, p.data.ownerId)) return actionError(NOT_ALLOWED);
  const old = id ? await prisma.deal.findFirst({ where: { workspaceId: actor.workspace.id, id } }) : null;
  if (id && (!old || !(await listDeals(actor)).some(d => d.id === id) || !canManageContacts(actor.membership) && old.ownerId !== actor.user.id)) return actionError(NOT_ALLOWED);
  const result = await prisma.$transaction(async tx => {
    const data = { ...p.data, ownerId: p.data.ownerId ?? actor.user.id };
    const row = old ? await tx.deal.update({ where: { id: old.id, workspaceId: actor.workspace.id }, data }) : await tx.deal.create({ data: { ...data, workspaceId: actor.workspace.id } });
    await audit(tx, actor, "deal_saved", "Deal", row.id);
    return old?.stage === row.stage ? null : dispatch(actor.workspace.id, { type: "deal.stage_changed", title: `${row.title}: ${row.stage}`.slice(0, 150), actorId: actor.user.id, recipients: [...new Set([row.ownerId, org.ownerId].filter((v): v is string => Boolean(v)))], useWorkspaceRules: false, resource: { type: "deal", id: row.id }, url: `/w/${actor.workspace.slug}/contacts/pipeline`, data: { dealId: row.id, organisationId: org.id, stage: row.stage } }, { tx });
  }); await result?.afterCommit(); return { ok: true };
}
export async function exportRelationships(actor: PeopleActor, format: "csv" | "vcard", id?: string): Promise<ActionResult<{ content: string; filename: string }>> {
  if (!canManageContacts(actor.membership)) return actionError(NOT_ALLOWED);
  if (id && !idSchema.safeParse(id).success) return actionError(NOT_ALLOWED);
  const contacts = (await listContacts(actor)).filter(c => !id || c.id === id);
  if (id && !contacts.length) return actionError(NOT_ALLOWED);
  const content = format === "vcard" ? contacts.map(c => exportVCard({ id: c.id, displayName: c.displayName, ...contactChannels(c) })).join("") : exportCsv([["name", "email", "phone", "tags", "kinds", "notes"], ...contacts.map(c => [c.displayName, contactChannels(c).email, contactChannels(c).phone, c.tags.join(";"), c.kinds.join(";"), c.notesMd ?? ""])]);
  await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: "contacts.exported", metadata: { format, count: contacts.length } });
  return { ok: true, data: { content, filename: `contacts.${format === "csv" ? "csv" : "vcf"}` } };
}
export async function importContacts(actor: PeopleActor, csv: unknown): Promise<ActionResult<{ created: number; skipped: number }>> {
  if (!canManageContacts(actor.membership)) return actionError(NOT_ALLOWED);
  if (typeof csv !== "string") return actionError("Choose a CSV file.");
  let rows: string[][]; try { rows = parseCsv(csv); } catch (e) { return actionError(e instanceof Error ? e.message : "Check the CSV format."); }
  const header = rows.shift()?.map(v => v.toLowerCase().trim()); if (!header?.includes("name") || new Set(header).size !== header.length) return actionError("Use one name column, plus optional email, phone, tags, kinds and notes columns.");
  const inputs: z.infer<typeof contactSchema>[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]; if (row.length !== header.length) return actionError(`Row ${index + 2} has a different number of columns.`);
    const values = Object.fromEntries(header.map((key, i) => [key, row[i]]));
    const p = contactSchema.safeParse({ displayName: values.name, email: values.email || "", phone: values.phone || "", tags: (values.tags || "").split(";").filter(Boolean), kinds: (values.kinds || "").split(";").filter(Boolean), notesMd: values.notes || "" });
    if (!p.success) return actionError(`Check row ${index + 2}: ${p.error.issues[0].message}`);
    inputs.push(p.data);
  }
  const counts = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm:import:${actor.workspace.id}`}))`;
    const existing = (await tx.contact.findMany({ where: { workspaceId: actor.workspace.id, deletedAt: null }, select: { id: true, displayName: true, emails: true, phones: true } })).map(c => ({ id: c.id, displayName: c.displayName, ...contactChannels(c) }));
    let created = 0; let skipped = 0;
    for (const input of inputs) {
      if (duplicateContacts({ displayName: input.displayName, email: input.email, phone: input.phone }, existing).length) { skipped++; continue; }
      const row = await tx.contact.create({ data: { workspaceId: actor.workspace.id, displayName: input.displayName, emails: input.email ? [{ type: "work", value: input.email.toLowerCase(), primary: true }] : [], phones: input.phone ? [{ type: "work", e164: input.phone, sensitive: false }] : [], tags: input.tags, kinds: input.kinds, notesMd: input.notesMd, ownerId: actor.user.id, createdById: actor.user.id } });
      await index(tx, actor, "contact", row, row.displayName); existing.push({ id: row.id, displayName: row.displayName, email: input.email, phone: input.phone }); created++;
    }
    await audit(tx, actor, "imported", "Contact", actor.workspace.id); return { created, skipped };
  }, { timeout: 30000 });
  return { ok: true, data: counts };
}

export async function exportOrganisations(actor: PeopleActor): Promise<ActionResult<{ content: string; filename: string }>> {
  if (!canManageContacts(actor.membership)) return actionError(NOT_ALLOWED);
  const organisations = await listOrganisations(actor);
  const content = exportCsv([["name", "website", "kinds", "tags", "address", "notes"], ...organisations.map(o => [o.name, o.website, o.kinds.join(";"), o.tags.join(";"), o.address, o.notesMd])]);
  await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: "contacts.organisations_exported", metadata: { count: organisations.length } });
  return { ok: true, data: { content, filename: "organisations.csv" } };
}

export async function importOrganisations(actor: PeopleActor, csv: unknown): Promise<ActionResult<{ created: number; skipped: number }>> {
  if (!canManageContacts(actor.membership)) return actionError(NOT_ALLOWED);
  if (typeof csv !== "string") return actionError("Choose a CSV file.");
  let rows: string[][];
  try { rows = parseCsv(csv); } catch (error) { return actionError(error instanceof Error ? error.message : "Check the CSV format."); }
  const header = rows.shift()?.map(v => v.trim().toLowerCase());
  if (!header?.includes("name") || new Set(header).size !== header.length) return actionError("Use one name column, plus optional website, kinds, tags, address and notes columns.");
  const inputs: z.output<typeof organisationSchema>[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== header.length) return actionError(`Row ${i + 2} has a different number of columns.`);
    const values = Object.fromEntries(header.map((key, column) => [key, rows[i][column]]));
    const parsed = organisationSchema.safeParse({ name: values.name, website: values.website || "", kinds: (values.kinds || "").split(";").filter(Boolean), tags: (values.tags || "").split(";").filter(Boolean), address: values.address || "", notesMd: values.notes || "" });
    if (!parsed.success) return actionError(`Check row ${i + 2}: ${parsed.error.issues[0].message}`);
    inputs.push(parsed.data);
  }
  const counts = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm:organisation-import:${actor.workspace.id}`}))`;
    const existing = await tx.organisation.findMany({ where: { workspaceId: actor.workspace.id, deletedAt: null }, select: { id: true, name: true, domain: true } });
    let created = 0; let skipped = 0;
    for (const input of inputs) {
      if (duplicateOrganisations(input, existing).length) { skipped++; continue; }
      const row = await tx.organisation.create({ data: { ...input, workspaceId: actor.workspace.id, ownerId: actor.user.id, createdById: actor.user.id, website: input.website || null, domain: input.website ? normalizeDomain(input.website) : null } });
      await index(tx, actor, "organisation", row, row.name);
      existing.push(row); created++;
    }
    await audit(tx, actor, "organisations_imported", "Organisation", actor.workspace.id);
    return { created, skipped };
  }, { timeout: 30000 });
  return { ok: true, data: counts };
}

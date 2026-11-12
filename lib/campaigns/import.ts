import "server-only";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { idSchema } from "@/lib/validation";
import { contactChannels } from "@/lib/contacts/contacts";
import { auditCampaignEvent } from "./audit";
import { getCampaignSettings } from "./settings";
import { validListIds } from "./lists";
import { buildConsent, type ConsentSource } from "./subscriptions";
import { MAX_IMPORT_ROWS, parseSubscriberCsv, type ImportProblem } from "./importCsv";
import { emailDomain, isDomainBlocked, isValidEmail, normaliseEmail } from "./policy";

export type ImportSummary = { created: number; existing: number; skipped: number; problems: ImportProblem[]; problemCount: number };

type Row = { email: string; name: string | null; attributes: Record<string, string>; contactId?: string };

const attestation = z.literal(true, { error: "Confirm that you have permission to email these people." });
const CHUNK = 500;

/** Insert subscribers and CONFIRMED subscriptions in chunks. Existing subscribers keep their data; unsubscribed and blocklisted people are never re-added. */
async function ingest(workspaceId: string, rows: Row[], listIds: string[], source: string, consentSource: ConsentSource, consentText: string): Promise<{ created: number; existing: number; skipped: number }> {
  let created = 0, existing = 0, skipped = 0;
  const consent = buildConsent({ source: consentSource, text: consentText }, false);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const emails = chunk.map((r) => r.email);
    const known = await prisma.subscriber.findMany({ where: { workspaceId, email: { in: emails } }, select: { email: true } });
    const knownSet = new Set(known.map((k) => k.email));
    const fresh = chunk.filter((r) => !knownSet.has(r.email));
    if (fresh.length) {
      const made = await prisma.subscriber.createMany({ skipDuplicates: true, data: fresh.map((r) => ({ workspaceId, email: r.email, emailDomain: emailDomain(r.email), name: r.name, attributes: r.attributes as Prisma.InputJsonValue, source, contactId: r.contactId ?? null, publicToken: randomToken(18) })) });
      created += made.count;
    }
    existing += chunk.length - fresh.length;
    const subscribers = await prisma.subscriber.findMany({ where: { workspaceId, email: { in: emails } }, select: { id: true, status: true } });
    const active = subscribers.filter((s) => s.status === "ACTIVE");
    skipped += subscribers.length - active.length;
    if (!listIds.length || !active.length) continue;
    const pairs = active.flatMap((s) => listIds.map((listId) => ({ subscriberId: s.id, listId, workspaceId, status: "CONFIRMED" as const, confirmedAt: new Date(), ...consent })));
    // skipDuplicates keeps existing subscriptions, so an earlier unsubscribe is respected.
    await prisma.listSubscription.createMany({ data: pairs, skipDuplicates: true });
  }
  return { created, existing, skipped };
}

const csvInput = z.object({ csv: z.string().max(3 * 1024 * 1024), listIds: z.array(idSchema).min(1, "Choose at least one list.").max(50), attest: attestation });

export async function importSubscribersCsv(workspaceId: string, actorId: string, input: unknown): Promise<ActionResult<ImportSummary>> {
  const p = csvInput.safeParse(input);
  if (!p.success) return validationError(p.error);
  const listIds = await validListIds(workspaceId, p.data.listIds);
  if (!listIds.length) return actionError("Choose at least one active list.");
  const settings = await getCampaignSettings(workspaceId);
  const parsed = parseSubscriberCsv(p.data.csv, settings.domainBlocklist);
  if (!parsed.ok) return actionError(parsed.error);
  const stats = await ingest(workspaceId, parsed.rows, listIds, "import", "IMPORT", "Imported by an admin who confirmed permission to email these people.");
  await auditCampaignEvent({ workspaceId, actorId, action: "subscribers_imported", metadata: { count: stats.created, existing: stats.existing, skipped: stats.skipped + parsed.problems.length } });
  return { ok: true, data: { ...stats, skipped: stats.skipped, problems: parsed.problems.slice(0, 100), problemCount: parsed.problems.length } };
}

const contactsInput = z.object({ listIds: z.array(idSchema).min(1, "Choose at least one list.").max(50), includeUnknown: z.boolean().default(false), attest: attestation });

/** Import contacts that have not opted out. Default: consent GRANTED only; `includeUnknown` also takes UNKNOWN or unset consent. */
export async function importFromContacts(workspaceId: string, actorId: string, input: unknown): Promise<ActionResult<ImportSummary>> {
  const p = contactsInput.safeParse(input);
  if (!p.success) return validationError(p.error);
  const listIds = await validListIds(workspaceId, p.data.listIds);
  if (!listIds.length) return actionError("Choose at least one active list.");
  const settings = await getCampaignSettings(workspaceId);
  const contacts = await prisma.contact.findMany({
    where: { workspaceId, deletedAt: null, doNotContact: false, ...(p.data.includeUnknown ? { OR: [{ consentStatus: null }, { consentStatus: { in: ["GRANTED", "UNKNOWN"] } }] } : { consentStatus: "GRANTED" }) },
    select: { id: true, displayName: true, emails: true, phones: true }, take: MAX_IMPORT_ROWS + 1,
  });
  if (contacts.length > MAX_IMPORT_ROWS) return actionError("That is more than 10,000 contacts. Narrow the selection first.");
  const problems: ImportProblem[] = [];
  const seen = new Set<string>();
  const rows: Row[] = [];
  contacts.forEach((c, i) => {
    const email = normaliseEmail(contactChannels(c).email);
    if (!email || !isValidEmail(email) || isDomainBlocked(email, settings.domainBlocklist) || seen.has(email)) { if (email) problems.push({ line: i + 1, message: "Skipped: invalid, blocklisted or duplicate address." }); return; }
    seen.add(email);
    rows.push({ email, name: c.displayName, attributes: {}, contactId: c.id });
  });
  const stats = await ingest(workspaceId, rows, listIds, "contact", "CONTACT", "Imported from contacts that have not opted out.");
  await auditCampaignEvent({ workspaceId, actorId, action: "subscribers_imported", metadata: { count: stats.created, existing: stats.existing, from: "contacts" } });
  return { ok: true, data: { ...stats, problems: problems.slice(0, 100), problemCount: problems.length } };
}

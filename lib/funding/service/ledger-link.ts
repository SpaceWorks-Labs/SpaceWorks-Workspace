import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isoDay } from "@/lib/finance/dates";
import { checkFcraFund } from "@/lib/finance/fcra";
import { FinanceError, assertOpen, financeAccess, lockFinance, validateTags, type FinanceActor } from "@/lib/finance/tools/access";
import { financeNote } from "@/lib/finance/tools/service/notes";
import { detailSchemas } from "@/lib/funding/schema";
import { FundingError } from "./access";

export const DONATION_SOURCE = "FUNDING_DONATION";
const DUPLICATE_DAYS = 3;
const cid = z.string().trim().max(64).regex(/^[A-Za-z0-9_-]*$/).nullish().transform((v) => v || null);

export const linkSchema = z.object({
  id: cid.refine((v) => !!v, "Choose a donation."),
  fundId: cid, accountId: cid, categoryId: cid,
  confirmDuplicate: z.boolean().default(false),
});
export const bulkSchema = linkSchema.omit({ id: true }).extend({ ids: z.array(z.string().trim().min(1).max(64)).min(1).max(100) });

export type DuplicateMatch = { id: string; description: string; occurredOn: string; amountMinor: number };
export type LinkResult =
  | { status: "posted" | "already"; entryId: string }
  | { status: "duplicate"; matches: DuplicateMatch[] };

async function findDuplicates(tx: DbClient, workspaceId: string, donor: string, amountMinor: number, currency: string, on: Date) {
  const day = 86_400_000;
  const rows = await tx.ledgerEntry.findMany({
    where: {
      workspaceId, kind: "INCOME", voidedAt: null, privatePayroll: false, amountMinor, currency,
      occurredOn: { gte: new Date(on.getTime() - DUPLICATE_DAYS * day), lte: new Date(on.getTime() + DUPLICATE_DAYS * day) },
      OR: [{ sourceType: null }, { sourceType: { not: DONATION_SOURCE } }, { counterparty: { equals: donor, mode: "insensitive" } }],
    },
    select: { id: true, description: true, occurredOn: true, amountMinor: true },
    take: 5,
  });
  return rows.map((r) => ({ id: r.id, description: r.description, occurredOn: isoDay(r.occurredOn), amountMinor: r.amountMinor }));
}

/** Posts one received cash donation to the ledger as INCOME. Idempotent per donation under retries and races. */
export async function recordDonationInLedger(actor: FinanceActor, raw: unknown): Promise<LinkResult> {
  const v = linkSchema.parse(raw);
  const workspaceId = actor.workspace.id;
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, workspaceId);
    await financeAccess(actor, "MANAGE", tx);
    const record = await tx.fundingRecord.findFirst({ where: { workspaceId, id: v.id!, kind: "DONATION", archivedAt: null } });
    if (!record || record.status !== "RECEIVED") throw new FundingError("Choose a received donation.");
    const existing = await tx.ledgerEntry.findFirst({ where: { sourceType: DONATION_SOURCE, sourceId: record.id, workspaceId }, select: { id: true } });
    if (existing) {
      if (record.ledgerEntryId !== existing.id) await tx.fundingRecord.updateMany({ where: { workspaceId, id: record.id }, data: { ledgerEntryId: existing.id } });
      return { status: "already", entryId: existing.id } as const;
    }
    const d = detailSchemas.DONATION.parse(record.details);
    if (d.mode === "IN_KIND") throw new FundingError("In-kind gifts don't go to the ledger. Create an asset record instead.");
    if (!record.dateOn || record.amountMinor <= 0) throw new FundingError("This donation needs a date and an amount before it can be recorded.");
    const fundId = v.fundId ?? record.fundId;
    await assertOpen(tx, workspaceId, record.dateOn, v.accountId);
    await validateTags(tx, workspaceId, { fundId, accountId: v.accountId, categoryId: v.categoryId }, record.currency, "INCOME");
    await checkFcraFund(tx, workspaceId, d.foreignSource, fundId);
    const donor = record.contactId ? (await tx.contact.findFirst({ where: { workspaceId, id: record.contactId }, select: { displayName: true } }))?.displayName ?? "" : "";
    if (!v.confirmDuplicate) {
      const matches = await findDuplicates(tx, workspaceId, donor, record.amountMinor, record.currency, record.dateOn);
      if (matches.length) return { status: "duplicate", matches } as const;
    }
    let entryId: string;
    try {
      entryId = (await tx.ledgerEntry.create({
        data: {
          workspaceId, kind: "INCOME", amountMinor: record.amountMinor, currency: record.currency, categoryId: v.categoryId, fundId, accountId: v.accountId,
          description: `Donation${donor ? ` from ${donor}` : ""}`.slice(0, 200), counterparty: donor || null, occurredOn: record.dateOn,
          incomeSource: "DONATION", sourceType: DONATION_SOURCE, sourceId: record.id, createdById: actor.user.id,
        },
      })).id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new FinanceError("This donation was just recorded. Refresh and check the ledger.");
      throw e;
    }
    await tx.fundingRecord.updateMany({ where: { workspaceId, id: record.id }, data: { ledgerEntryId: entryId } });
    await financeNote(tx, actor, "entry", entryId, "created", `Donation${donor ? ` from ${donor}` : ""}`, "ledger");
    await recordAuditEvent({ workspaceId, actorId: actor.user.id, action: "funding.donation_ledger_posted", targetType: "funding_record", targetId: record.id, metadata: { entryId, confirmedDuplicate: v.confirmDuplicate }, client: tx });
    return { status: "posted", entryId } as const;
  }, { timeout: 20000 });
}

/** Voiding a donation voids its ledger entry. Runs inside the caller's transaction, which holds the finance lock. */
export async function voidDonationLedgerEntry(tx: DbClient, workspaceId: string, recordId: string, actorId: string) {
  const voided = await tx.ledgerEntry.updateMany({ where: { workspaceId, sourceType: DONATION_SOURCE, sourceId: recordId, voidedAt: null }, data: { voidedAt: new Date() } });
  if (voided.count)
    await recordAuditEvent({ workspaceId, actorId, action: "funding.donation_ledger_voided", targetType: "funding_record", targetId: recordId, client: tx });
}

export type BulkItem = { id: string; result: LinkResult | { status: "error"; error: string } };
/** Records each selected donation on its own, so one failure never blocks the rest. */
export async function recordDonationsInLedger(actor: FinanceActor, raw: unknown): Promise<BulkItem[]> {
  const { ids, ...rest } = bulkSchema.parse(raw);
  const out: BulkItem[] = [];
  for (const id of [...new Set(ids)]) {
    try { out.push({ id, result: await recordDonationInLedger(actor, { ...rest, id }) }); }
    catch (e) {
      if (e instanceof FundingError || e instanceof FinanceError) out.push({ id, result: { status: "error", error: e.message } });
      else throw e;
    }
  }
  return out;
}

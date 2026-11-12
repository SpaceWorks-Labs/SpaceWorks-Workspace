import "server-only";
import { z } from "zod";
import { prisma, type DbClient } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isoDay } from "@/lib/finance/dates";
import { FinanceError, assertOpen, financeAccess, lockFinance, unavailable, type FinanceActor } from "@/lib/finance/tools/access";
import { addEntry } from "@/lib/finance/tools/service";

const lineId = z.string().trim().min(1).max(128);
const optionalId = z.string().trim().max(128).nullish().transform((v) => v || null);

const MATCHED_BY_OTHER = "That entry is already matched to another bank line.";

async function loadLine(tx: DbClient, workspaceId: string, id: string) {
  const line = await tx.financeBankLine.findFirst({ where: { id, workspaceId } });
  if (!line) throw new FinanceError(unavailable);
  return line;
}

async function audit(tx: DbClient, actor: FinanceActor, action: string, id: string, entryId: string | null) {
  await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action, targetType: "bank_line", targetId: id, metadata: { entryId }, client: tx });
}

/** Link one bank line to one ledger entry and mark the entry reconciled. Same lock and period rules as manual reconciliation. */
export async function matchBankLine(actor: FinanceActor, input: { lineId: string; entryId: string }) {
  await financeAccess(actor, "MANAGE");
  const v = z.object({ lineId, entryId: lineId }).parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const line = await loadLine(tx, actor.workspace.id, v.lineId);
    if (line.status !== "UNMATCHED") throw new FinanceError("That bank line is already matched or ignored.");
    const entry = await tx.ledgerEntry.findFirst({ where: { id: v.entryId, workspaceId: actor.workspace.id, voidedAt: null, privatePayroll: false } });
    if (!entry) throw new FinanceError(unavailable);
    if (entry.accountId !== line.accountId) throw new FinanceError("Choose an entry from the same account as the bank line.");
    if ((entry.kind === "INCOME" ? entry.amountMinor : -entry.amountMinor) !== line.amountMinor || entry.currency !== line.currency)
      throw new FinanceError("The amount differs. Match entries of the same amount, or edit the entry first.");
    await assertOpen(tx, actor.workspace.id, entry.occurredOn, entry.accountId);
    if (await tx.financeBankLine.findFirst({ where: { workspaceId: actor.workspace.id, ledgerEntryId: entry.id, status: "MATCHED" }, select: { id: true } }))
      throw new FinanceError(MATCHED_BY_OTHER);
    const now = new Date();
    const claimed = await tx.financeBankLine.updateMany({
      where: { id: line.id, workspaceId: actor.workspace.id, status: "UNMATCHED" },
      data: { status: "MATCHED", ledgerEntryId: entry.id, matchedAt: now, matchedById: actor.user.id },
    });
    if (claimed.count !== 1) throw new FinanceError("That bank line is already matched or ignored.");
    // An entry reconciled by hand keeps its original timestamp.
    await tx.ledgerEntry.updateMany({ where: { id: entry.id, workspaceId: actor.workspace.id, reconciledAt: null }, data: { reconciledAt: now } });
    await audit(tx, actor, "finance.bank_line_matched", line.id, entry.id);
    return line.id;
  });
}

/** Undo a match; the entry is un-reconciled only if this match is what reconciled it. */
export async function unmatchBankLine(actor: FinanceActor, input: { lineId: string }) {
  await financeAccess(actor, "MANAGE");
  const v = z.object({ lineId }).parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const line = await loadLine(tx, actor.workspace.id, v.lineId);
    if (line.status !== "MATCHED" || !line.ledgerEntryId) throw new FinanceError("That bank line is not matched.");
    const entry = await tx.ledgerEntry.findFirst({ where: { id: line.ledgerEntryId, workspaceId: actor.workspace.id } });
    if (entry) {
      await assertOpen(tx, actor.workspace.id, entry.occurredOn, entry.accountId);
      if (entry.reconciledAt && line.matchedAt && entry.reconciledAt.getTime() === line.matchedAt.getTime())
        await tx.ledgerEntry.updateMany({ where: { id: entry.id, workspaceId: actor.workspace.id }, data: { reconciledAt: null } });
    }
    await tx.financeBankLine.updateMany({
      where: { id: line.id, workspaceId: actor.workspace.id },
      data: { status: "UNMATCHED", ledgerEntryId: null, matchedAt: null, matchedById: null },
    });
    await audit(tx, actor, "finance.bank_line_unmatched", line.id, line.ledgerEntryId);
    return line.id;
  });
}

/** Ignore (or restore) a line that has no ledger counterpart, such as a bank charge already booked elsewhere. */
export async function setBankLineIgnored(actor: FinanceActor, input: { lineId: string; ignored: boolean }) {
  await financeAccess(actor, "MANAGE");
  const v = z.object({ lineId, ignored: z.boolean() }).parse(input);
  return prisma.$transaction(async (tx) => {
    const line = await loadLine(tx, actor.workspace.id, v.lineId);
    const from = v.ignored ? "UNMATCHED" : "IGNORED";
    if (line.status !== from) throw new FinanceError(v.ignored ? "Only an unmatched line can be ignored." : "That bank line is not ignored.");
    await tx.financeBankLine.updateMany({ where: { id: line.id, workspaceId: actor.workspace.id, status: from }, data: { status: v.ignored ? "IGNORED" : "UNMATCHED" } });
    await audit(tx, actor, v.ignored ? "finance.bank_line_ignored" : "finance.bank_line_restored", line.id, null);
    return line.id;
  });
}

const fromLineSchema = z.object({
  lineId,
  categoryId: optionalId,
  fundId: optionalId,
  costCentreId: optionalId,
  description: z.string().trim().max(120).optional(),
});

/**
 * Create a ledger entry from an unmatched bank line through the ordinary
 * add-entry path (account, period, signed-month and fund rules all apply),
 * then link it. The entry date, amount, kind and account come from the line.
 */
export async function createEntryFromBankLine(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = fromLineSchema.parse(input);
  const line = await loadLine(prisma, actor.workspace.id, v.lineId);
  if (line.status !== "UNMATCHED") throw new FinanceError("That bank line is already matched or ignored.");
  const entryId = await addEntry(actor, {
    kind: line.amountMinor > 0 ? "INCOME" : "EXPENSE",
    amountMinor: Math.abs(line.amountMinor),
    currency: line.currency,
    occurredOn: isoDay(line.postedOn),
    description: v.description || line.description.slice(0, 120),
    counterparty: null,
    accountId: line.accountId,
    categoryId: v.categoryId,
    fundId: v.fundId,
    costCentreId: v.costCentreId,
  });
  await matchBankLine(actor, { lineId: line.id, entryId });
  return { lineId: line.id, entryId };
}

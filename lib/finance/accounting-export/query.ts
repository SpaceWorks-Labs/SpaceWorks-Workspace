import "server-only";
import { prisma } from "@/lib/db";
import { dateOnly, isoDay } from "@/lib/finance/dates";
import { FinanceError, financeAccess, type FinanceActor } from "@/lib/finance/tools/access";
import { FORMAT_INFO, type AccountingFormat, type ExportRow, type UnmappedEntry } from "./types";

export const MAX_EXPORT_ROWS = 20000;
export type ExportFilter = { from: string; to: string; accountId?: string | null; journalLedger?: string | null };

const code = (value: string | null | undefined) => value?.trim() || null;

/**
 * Non-void, non-payroll entries in range, split into rows the format can
 * express and entries that are listed as unmapped. A missing ledger code is
 * never guessed or defaulted.
 */
export async function loadAccountingRows(actor: FinanceActor, format: AccountingFormat, filter: ExportFilter) {
  await financeAccess(actor, "VIEW");
  const workspaceId = actor.workspace.id;
  if (FORMAT_INFO[format].needsAccount && !filter.accountId) throw new FinanceError("Choose one bank account for this format.");
  if (filter.accountId && !(await prisma.financeAccount.findFirst({ where: { id: filter.accountId, workspaceId }, select: { id: true } })))
    throw new FinanceError("Choose an account in this workspace.");
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      workspaceId,
      voidedAt: null,
      privatePayroll: false,
      currency: actor.workspace.currency,
      occurredOn: { gte: dateOnly(filter.from), lte: dateOnly(filter.to) },
      ...(filter.accountId ? { accountId: filter.accountId } : {}),
    },
    include: { category: { select: { name: true, externalCode: true } }, account: { select: { name: true, externalCode: true } } },
    orderBy: [{ occurredOn: "asc" }, { id: "asc" }],
    take: MAX_EXPORT_ROWS + 1,
  });
  if (entries.length > MAX_EXPORT_ROWS) throw new FinanceError("This export has more than 20,000 records. Choose a shorter period.");
  const statementFormat = FORMAT_INFO[format].needsAccount;
  const journalLedger = code(filter.journalLedger);
  const rows: ExportRow[] = [];
  const unmapped: UnmappedEntry[] = [];
  for (const e of entries) {
    const base = {
      id: e.id,
      date: isoDay(e.occurredOn),
      kind: e.kind,
      amountMinor: e.amountMinor,
      currency: e.currency,
      description: e.description,
      counterparty: e.counterparty,
      reference: e.invoiceNumber,
      categoryName: e.category?.name ?? null,
      categoryCode: code(e.category?.externalCode),
    };
    const reasons: string[] = [];
    if (!statementFormat) {
      if (!base.categoryCode) reasons.push(e.category ? `Category "${e.category.name}" has no ledger code` : "No category");
      if (!e.account && !journalLedger) reasons.push("No bank account (name a journal ledger to export it as a Journal voucher)");
      else if (e.account && !code(e.account.externalCode)) reasons.push(`Account "${e.account.name}" has no ledger code`);
    }
    if (reasons.length) unmapped.push({ id: e.id, date: base.date, description: e.description, amountMinor: e.amountMinor, kind: e.kind, reason: reasons.join("; ") });
    else
      rows.push({
        ...base,
        accountName: e.account?.name ?? null,
        accountCode: e.account ? code(e.account.externalCode) : journalLedger,
        journal: !e.account,
      });
  }
  return { rows, unmapped };
}

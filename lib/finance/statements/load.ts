import "server-only";
import { prisma } from "@/lib/db";
import { dateOnly, isoDay, localDate } from "@/lib/finance/dates";
import { financeAccess, type FinanceActor } from "@/lib/finance/tools/access";
import { fiscalYearOf, fiscalYearRange, recentFiscalYears } from "./fiscal";
import { fundStatement, incomeAndExpenditure, receiptsAndPayments, type StmtEntry } from "./compute";

export type StatementQuery = { year?: number; currency?: string };

/**
 * Cash-basis statements for one financial year and one currency. Void entries and
 * private payroll postings never count, and account transfers are not income or expense.
 */
export async function loadStatements(actor: FinanceActor, query: StatementQuery = {}) {
  await financeAccess(actor, "VIEW");
  const workspaceId = actor.workspace.id;
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { fiscalYearStartMonth: true, currency: true, timezone: true },
  });
  const startMonth = ws.fiscalYearStartMonth;
  const today = localDate(new Date(), ws.timezone);
  const year = query.year && query.year >= 2000 && query.year <= 2200 ? query.year : fiscalYearOf(today, startMonth);
  const range = fiscalYearRange(startMonth, year);
  const currency = /^[A-Z]{3}$/.test(query.currency ?? "") ? query.currency! : ws.currency;
  const until = dateOnly(range.to);
  const [rows, accounts, funds, movements, used] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { workspaceId, currency, voidedAt: null, privatePayroll: false, occurredOn: { lte: until } },
      select: { kind: true, amountMinor: true, fundId: true, accountId: true, occurredOn: true, category: { select: { name: true } } },
    }),
    prisma.financeAccount.findMany({ where: { workspaceId, currency }, orderBy: { name: "asc" } }),
    prisma.financeFund.findMany({ where: { workspaceId, currency }, orderBy: { name: "asc" } }),
    prisma.moneyControlMovement.findMany({
      where: { workspaceId, currency, occurredOn: { lte: until }, record: { payroll: false } },
      select: { accountId: true, amountMinor: true, occurredOn: true },
    }),
    prisma.ledgerEntry.groupBy({ by: ["currency"], where: { workspaceId, voidedAt: null, privatePayroll: false } }),
  ]);
  const entries: StmtEntry[] = rows.map((e) => ({
    kind: e.kind, amountMinor: e.amountMinor, categoryName: e.category?.name ?? null, fundId: e.fundId, accountId: e.accountId, on: isoDay(e.occurredOn),
  }));
  const range2 = { from: range.from, to: range.to };
  return {
    workspaceName: actor.workspace.name,
    range, startMonth, currency,
    currencies: [...new Set([ws.currency, ...used.map((u) => u.currency)])].sort(),
    years: recentFiscalYears(today, startMonth),
    rp: receiptsAndPayments(
      entries,
      accounts.map((a) => ({ id: a.id, name: a.name, openingMinor: a.openingMinor, openingOn: isoDay(a.openingOn) })),
      movements.map((m) => ({ accountId: m.accountId, amountMinor: m.amountMinor, on: isoDay(m.occurredOn) })),
      range2,
    ),
    ie: incomeAndExpenditure(entries, range2),
    funds: fundStatement(entries, funds.map((f) => ({ id: f.id, name: f.name, restricted: f.restricted, fcra: f.fcra })), range2),
    fundList: funds.filter((f) => !f.archivedAt).map((f) => ({ id: f.id, name: f.name, fcra: f.fcra, restricted: f.restricted })),
  };
}
export type StatementData = Awaited<ReturnType<typeof loadStatements>>;

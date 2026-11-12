import "server-only";
import { prisma } from "@/lib/db";
import { isoDay } from "@/lib/finance/dates";
import { financeAccess, type FinanceActor } from "@/lib/finance/tools/access";
import { manualCandidates, suggestMatches, type MatchEntry, type MatchSuggestion } from "../matcher";

export const BANK_PAGE_SIZE = 50;
export type BankLineStatus = "UNMATCHED" | "MATCHED" | "IGNORED";

export type BankLineView = {
  id: string;
  postedOn: string;
  description: string;
  reference: string | null;
  amountMinor: number;
  currency: string;
  status: BankLineStatus;
  matchedEntry: { id: string; description: string; occurredOn: string } | null;
  suggestion: (MatchSuggestion & { entry: MatchEntry }) | null;
  options: MatchEntry[];
};

export async function loadBankView(actor: FinanceActor, query: { accountId?: string; status?: string; page?: string }) {
  await financeAccess(actor, "VIEW");
  const workspaceId = actor.workspace.id;
  const accounts = await prisma.financeAccount.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true, currency: true } });
  const account = accounts.find((a) => a.id === query.accountId) ?? accounts[0] ?? null;
  if (!account) return { accounts, account: null, statements: [], lines: [], total: 0, unmatchedCount: 0 };
  const status: BankLineStatus | null = query.status === "MATCHED" || query.status === "IGNORED" || query.status === "UNMATCHED" ? query.status : null;
  const page = Math.max(1, Math.min(1000, Number.parseInt(query.page ?? "1", 10) || 1));
  const where = { workspaceId, accountId: account.id, ...(status ? { status } : {}) };
  const [statements, rows, total, unmatchedCount, unmatched] = await Promise.all([
    prisma.financeBankStatement.findMany({ where: { workspaceId, accountId: account.id }, orderBy: { importedAt: "desc" }, take: 10 }),
    prisma.financeBankLine.findMany({ where, orderBy: [{ postedOn: "desc" }, { id: "desc" }], skip: (page - 1) * BANK_PAGE_SIZE, take: BANK_PAGE_SIZE }),
    prisma.financeBankLine.count({ where }),
    prisma.financeBankLine.count({ where: { workspaceId, accountId: account.id, status: "UNMATCHED" } }),
    prisma.financeBankLine.findMany({ where: { workspaceId, accountId: account.id, status: "UNMATCHED" }, orderBy: { postedOn: "asc" }, take: 1000 }),
  ]);
  const pool = unmatched.length ? await candidateEntries(workspaceId, account.id, unmatched[0]!.postedOn, unmatched[unmatched.length - 1]!.postedOn) : [];
  const toMatchLine = (l: (typeof unmatched)[number]) => ({ id: l.id, postedOn: isoDay(l.postedOn), amountMinor: l.amountMinor, description: l.description, reference: l.reference });
  const suggestions = new Map(suggestMatches(unmatched.map(toMatchLine), pool).map((s) => [s.lineId, s]));
  const poolById = new Map(pool.map((e) => [e.id, e]));
  const matchedIds = rows.map((r) => r.ledgerEntryId).filter((v): v is string => !!v);
  const matchedEntries = matchedIds.length ? await prisma.ledgerEntry.findMany({ where: { workspaceId, id: { in: matchedIds }, privatePayroll: false }, select: { id: true, description: true, occurredOn: true } }) : [];
  const lines: BankLineView[] = rows.map((l) => {
    const view = toMatchLine(l);
    const s = l.status === "UNMATCHED" ? suggestions.get(l.id) : undefined;
    const entry = matchedEntries.find((e) => e.id === l.ledgerEntryId);
    return {
      id: l.id,
      postedOn: view.postedOn,
      description: l.description,
      reference: l.reference,
      amountMinor: l.amountMinor,
      currency: l.currency,
      status: l.status as BankLineStatus,
      matchedEntry: entry ? { id: entry.id, description: entry.description, occurredOn: isoDay(entry.occurredOn) } : null,
      suggestion: s && poolById.get(s.entryId) ? { ...s, entry: poolById.get(s.entryId)! } : null,
      options: l.status === "UNMATCHED" ? manualCandidates(view, pool).filter((e) => e.id !== s?.entryId) : [],
    };
  });
  return { accounts, account, statements, lines, total, unmatchedCount };
}

/** Open (unreconciled, unmatched, non-payroll) entries near the unmatched lines' date range. */
async function candidateEntries(workspaceId: string, accountId: string, from: Date, to: Date): Promise<MatchEntry[]> {
  const pad = 45 * 86_400_000;
  const rows = await prisma.ledgerEntry.findMany({
    where: {
      workspaceId,
      accountId,
      voidedAt: null,
      privatePayroll: false,
      reconciledAt: null,
      occurredOn: { gte: new Date(from.getTime() - pad), lte: new Date(to.getTime() + pad) },
    },
    orderBy: { occurredOn: "asc" },
    take: 3000,
    select: { id: true, occurredOn: true, kind: true, amountMinor: true, description: true, counterparty: true, invoiceNumber: true },
  });
  return rows.map((r) => ({ ...r, occurredOn: isoDay(r.occurredOn) }));
}


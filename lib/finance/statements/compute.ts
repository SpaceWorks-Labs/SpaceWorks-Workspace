/** Cash-basis statement maths (pure). Callers pass non-void, non-payroll rows in one currency. */

export type StmtEntry = {
  kind: "INCOME" | "EXPENSE";
  amountMinor: number;
  categoryName: string | null;
  fundId: string | null;
  accountId: string | null;
  /** YYYY-MM-DD */
  on: string;
};
export type StmtAccount = { id: string; name: string; openingMinor: number; openingOn: string };
export type StmtFund = { id: string; name: string; restricted: boolean; fcra: boolean };
/** Signed account movement (transfers and replenishments between accounts). */
export type StmtMovement = { accountId: string; amountMinor: number; on: string };
export type StmtRange = { from: string; to: string };

export const UNCATEGORISED = "Uncategorised";
export const NO_ACCOUNT = "No account assigned";
export const GENERAL_FUND = "General (no fund)";

const signed = (e: Pick<StmtEntry, "kind" | "amountMinor">) => (e.kind === "INCOME" ? e.amountMinor : -e.amountMinor);
const sum = (rows: number[]) => rows.reduce((a, b) => a + b, 0);

export type Head = { name: string; amountMinor: number };
function heads(entries: StmtEntry[], kind: StmtEntry["kind"]): Head[] {
  const map = new Map<string, number>();
  for (const e of entries) if (e.kind === kind) map.set(e.categoryName ?? UNCATEGORISED, (map.get(e.categoryName ?? UNCATEGORISED) ?? 0) + e.amountMinor);
  return [...map].map(([name, amountMinor]) => ({ name, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name));
}
const inRange = (on: string, r: StmtRange) => on >= r.from && on <= r.to;

export type CashLine = { accountId: string | null; name: string; openingMinor: number; transfersMinor: number; closingMinor: number };
export type ReceiptsPayments = {
  receipts: Head[]; payments: Head[]; receiptsMinor: number; paymentsMinor: number;
  cash: CashLine[]; openingMinor: number; transfersMinor: number; closingMinor: number;
};

export function receiptsAndPayments(entries: StmtEntry[], accounts: StmtAccount[], movements: StmtMovement[], r: StmtRange): ReceiptsPayments {
  const period = entries.filter((e) => inRange(e.on, r));
  const live = accounts.filter((a) => a.openingOn <= r.to);
  const lines = [...live.map((a) => ({ id: a.id as string | null, name: a.name, base: a.openingMinor })), { id: null, name: NO_ACCOUNT, base: 0 }];
  const cash: CashLine[] = lines.map((l) => {
    const mine = (x: { accountId: string | null }) => x.accountId === l.id;
    const openingMinor = l.base + sum(entries.filter((e) => mine(e) && e.on < r.from).map(signed)) + sum(movements.filter((m) => mine(m) && m.on < r.from).map((m) => m.amountMinor));
    const flow = sum(period.filter(mine).map(signed));
    const transfersMinor = sum(movements.filter((m) => mine(m) && inRange(m.on, r)).map((m) => m.amountMinor));
    return { accountId: l.id, name: l.name, openingMinor, transfersMinor, closingMinor: openingMinor + flow + transfersMinor };
  }).filter((c) => c.accountId || c.openingMinor || c.transfersMinor || c.closingMinor);
  const receipts = heads(period, "INCOME"), payments = heads(period, "EXPENSE");
  return {
    receipts, payments, receiptsMinor: sum(receipts.map((h) => h.amountMinor)), paymentsMinor: sum(payments.map((h) => h.amountMinor)), cash,
    openingMinor: sum(cash.map((c) => c.openingMinor)), transfersMinor: sum(cash.map((c) => c.transfersMinor)), closingMinor: sum(cash.map((c) => c.closingMinor)),
  };
}

export type IncomeExpenditure = { income: Head[]; expenditure: Head[]; incomeMinor: number; expenditureMinor: number; surplusMinor: number };
export function incomeAndExpenditure(entries: StmtEntry[], r: StmtRange): IncomeExpenditure {
  const period = entries.filter((e) => inRange(e.on, r));
  const income = heads(period, "INCOME"), expenditure = heads(period, "EXPENSE");
  const incomeMinor = sum(income.map((h) => h.amountMinor)), expenditureMinor = sum(expenditure.map((h) => h.amountMinor));
  return { income, expenditure, incomeMinor, expenditureMinor, surplusMinor: incomeMinor - expenditureMinor };
}

export type FundLine = { fundId: string | null; name: string; restricted: boolean; fcra: boolean; openingMinor: number; receiptsMinor: number; utilisedMinor: number; closingMinor: number };
export type FundStatement = { lines: FundLine[]; restricted: FundLine; unrestricted: FundLine; total: FundLine };
const blank = (name: string): FundLine => ({ fundId: null, name, restricted: false, fcra: false, openingMinor: 0, receiptsMinor: 0, utilisedMinor: 0, closingMinor: 0 });
function add(a: FundLine, b: FundLine): FundLine {
  return { ...a, openingMinor: a.openingMinor + b.openingMinor, receiptsMinor: a.receiptsMinor + b.receiptsMinor, utilisedMinor: a.utilisedMinor + b.utilisedMinor, closingMinor: a.closingMinor + b.closingMinor };
}
export function fundStatement(entries: StmtEntry[], funds: StmtFund[], r: StmtRange): FundStatement {
  const rows: Array<StmtFund | { id: null; name: string; restricted: false; fcra: false }> = [...funds, { id: null, name: GENERAL_FUND, restricted: false, fcra: false }];
  const lines = rows.map((f) => {
    const mine = entries.filter((e) => e.fundId === f.id);
    const openingMinor = sum(mine.filter((e) => e.on < r.from).map(signed));
    const period = mine.filter((e) => inRange(e.on, r));
    const receiptsMinor = sum(period.filter((e) => e.kind === "INCOME").map((e) => e.amountMinor));
    const utilisedMinor = sum(period.filter((e) => e.kind === "EXPENSE").map((e) => e.amountMinor));
    return { fundId: f.id, name: f.name, restricted: f.restricted, fcra: f.fcra, openingMinor, receiptsMinor, utilisedMinor, closingMinor: openingMinor + receiptsMinor - utilisedMinor } satisfies FundLine;
  }).filter((l) => l.fundId || l.openingMinor || l.receiptsMinor || l.utilisedMinor);
  const fold = (name: string, pick: (l: FundLine) => boolean) => lines.filter(pick).reduce(add, blank(name));
  return { lines, restricted: fold("Restricted funds", (l) => l.restricted), unrestricted: fold("Unrestricted funds", (l) => !l.restricted), total: fold("All funds", () => true) };
}

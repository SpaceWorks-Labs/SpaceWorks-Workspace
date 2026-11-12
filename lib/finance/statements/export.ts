import { toCsv } from "@/lib/finance/csv";
import { minorToDecimalString } from "@/lib/finance/money";
import { currencyMinorDigits } from "@/lib/format/money";
import { STATEMENT_DISCLAIMER } from "./fiscal";
import type { StatementData } from "./load";

export const STATEMENT_KINDS = ["receipts-payments", "income-expenditure", "funds"] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];
export const STATEMENT_TITLES: Record<StatementKind, string> = {
  "receipts-payments": "Receipts and Payments",
  "income-expenditure": "Income and Expenditure",
  funds: "Fund statement",
};

type Table = { title: string; head: string[]; rows: string[][] };

/** One table list per statement, shared by CSV and PDF so both always agree. */
export function statementTables(d: StatementData, kind: StatementKind, m: (v: number) => string): Table[] {
  if (kind === "receipts-payments") {
    const { rp } = d;
    return [
      { title: "Cash and bank", head: ["Account", "Opening", "Transfers", "Closing"], rows: [...rp.cash.map((c) => [c.name, m(c.openingMinor), m(c.transfersMinor), m(c.closingMinor)]), ["Total", m(rp.openingMinor), m(rp.transfersMinor), m(rp.closingMinor)]] },
      { title: "Receipts", head: ["Head", "Amount"], rows: [...rp.receipts.map((h) => [h.name, m(h.amountMinor)]), ["Total receipts", m(rp.receiptsMinor)]] },
      { title: "Payments", head: ["Head", "Amount"], rows: [...rp.payments.map((h) => [h.name, m(h.amountMinor)]), ["Total payments", m(rp.paymentsMinor)]] },
    ];
  }
  if (kind === "income-expenditure") {
    const { ie } = d;
    return [
      { title: "Income", head: ["Category", "Amount"], rows: [...ie.income.map((h) => [h.name, m(h.amountMinor)]), ["Total income", m(ie.incomeMinor)]] },
      { title: "Expenditure", head: ["Category", "Amount"], rows: [...ie.expenditure.map((h) => [h.name, m(h.amountMinor)]), ["Total expenditure", m(ie.expenditureMinor)]] },
      { title: ie.surplusMinor >= 0 ? "Surplus" : "Deficit", head: ["Result", "Amount"], rows: [[ie.surplusMinor >= 0 ? "Surplus for the year" : "Deficit for the year", m(ie.surplusMinor)]] },
    ];
  }
  const f = d.funds;
  const line = (l: (typeof f.lines)[number]) => [l.name, l.restricted ? "Restricted" : "Unrestricted", l.fcra ? "FCRA" : "", m(l.openingMinor), m(l.receiptsMinor), m(l.utilisedMinor), m(l.closingMinor)];
  return [{
    title: "Funds", head: ["Fund", "Type", "FCRA", "Opening", "Receipts", "Utilisation", "Closing"],
    rows: [...f.lines.map(line), ...[f.restricted, f.unrestricted, f.total].map((l) => [l.name, "", "", m(l.openingMinor), m(l.receiptsMinor), m(l.utilisedMinor), m(l.closingMinor)])],
  }];
}

export function statementCsv(d: StatementData, kind: StatementKind): string {
  const head = [[STATEMENT_TITLES[kind]], [`Financial year ${d.range.label}`, d.range.from, d.range.to, d.currency], [STATEMENT_DISCLAIMER], ["Excludes void entries and private payroll."], []];
  const body = statementTables(d, kind, (v) => minorToDecimalString(v, d.currency)).flatMap((t) => [[t.title], t.head, ...t.rows, []]);
  return toCsv([...head, ...body]);
}

/** Currency code instead of a symbol: the PDF font has no rupee glyph. */
function codeMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, currencyDisplay: "code" }).format(minor / 10 ** currencyMinorDigits(currency));
}

export function statementPdfSections(d: StatementData, kind: StatementKind) {
  return statementTables(d, kind, (v) => codeMoney(v, d.currency)).map((t) => ({
    title: t.title,
    rows: [t.head, ...t.rows],
  }));
}

import { Callout } from "@/components/ui/display";
import { STATEMENT_DISCLAIMER } from "@/lib/finance/statements/fiscal";
import type { StatementData } from "@/lib/finance/statements/load";
import { StatementTable, type StatementRow } from "./StatementTable";

const total = (name: string, ...cells: number[]): StatementRow => ({ name, cells, strong: true });

export function StatementsView({ data }: { data: StatementData }) {
  const { rp, ie, funds, currency } = data;
  const fundRows: StatementRow[] = [
    ...funds.lines.map((l) => ({ name: l.name, cells: [l.openingMinor, l.receiptsMinor, l.utilisedMinor, l.closingMinor], note: [l.restricted ? "Restricted" : "Unrestricted", l.fcra ? "FCRA" : ""].filter(Boolean).join(", ") })),
    ...[funds.restricted, funds.unrestricted, funds.total].map((l) => total(l.name, l.openingMinor, l.receiptsMinor, l.utilisedMinor, l.closingMinor)),
  ];
  return (
    <div className="flex flex-col gap-6">
      <Callout tone="info" title="Management statements">{STATEMENT_DISCLAIMER} Void entries and private payroll are left out. Transfers between accounts are not income or expense.</Callout>
      <section aria-labelledby="rp" className="flex flex-col gap-4">
        <h2 id="rp" className="text-h2">Receipts and Payments</h2>
        <StatementTable title="Cash and bank balances" firstHead="Account" heads={["Opening", "Transfers", "Closing"]} currency={currency}
          rows={[...rp.cash.map((c) => ({ name: c.name, cells: [c.openingMinor, c.transfersMinor, c.closingMinor] })), total("Total", rp.openingMinor, rp.transfersMinor, rp.closingMinor)]} />
        <StatementTable title="Receipts" firstHead="Head" heads={["Amount"]} currency={currency} rows={[...rp.receipts.map((h) => ({ name: h.name, cells: [h.amountMinor] })), total("Total receipts", rp.receiptsMinor)]} />
        <StatementTable title="Payments" firstHead="Head" heads={["Amount"]} currency={currency} rows={[...rp.payments.map((h) => ({ name: h.name, cells: [h.amountMinor] })), total("Total payments", rp.paymentsMinor)]} />
      </section>
      <section aria-labelledby="ie" className="flex flex-col gap-4">
        <h2 id="ie" className="text-h2">Income and Expenditure</h2>
        <StatementTable title="Income" firstHead="Category" heads={["Amount"]} currency={currency} rows={[...ie.income.map((h) => ({ name: h.name, cells: [h.amountMinor] })), total("Total income", ie.incomeMinor)]} />
        <StatementTable title="Expenditure" firstHead="Category" heads={["Amount"]} currency={currency} rows={[...ie.expenditure.map((h) => ({ name: h.name, cells: [h.amountMinor] })), total("Total expenditure", ie.expenditureMinor)]} />
        <StatementTable title={ie.surplusMinor >= 0 ? "Surplus" : "Deficit"} firstHead="Result" heads={["Amount"]} currency={currency} rows={[total(ie.surplusMinor >= 0 ? "Surplus for the year" : "Deficit for the year", ie.surplusMinor)]} />
      </section>
      <section aria-labelledby="fs" className="flex flex-col gap-4">
        <h2 id="fs" className="text-h2">Fund statement</h2>
        <StatementTable title="Funds" firstHead="Fund" heads={["Opening", "Receipts", "Utilisation", "Closing"]} currency={currency} rows={fundRows} />
      </section>
    </div>
  );
}

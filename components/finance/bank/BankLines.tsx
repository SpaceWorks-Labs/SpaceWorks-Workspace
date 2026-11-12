import Link from "next/link";
import { EmptyState } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMoney } from "@/lib/format/money";
import type { BankLineView } from "@/lib/finance/bank";
import { BankLineActions } from "./BankLineActions";
import type { EntryOptions } from "./CreateEntryDialog";

const FILTERS = [
  { value: "", label: "All" },
  { value: "UNMATCHED", label: "Unmatched" },
  { value: "MATCHED", label: "Matched" },
  { value: "IGNORED", label: "Ignored" },
];

export function BankLines({ slug, base, accountId, status, lines, options, canManage }: { slug: string; base: string; accountId: string; status: string; lines: BankLineView[]; options: EntryOptions; canManage: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Filter bank lines" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.value} href={`${base}?account=${accountId}${f.value ? `&status=${f.value}` : ""}`} aria-current={status === f.value ? "page" : undefined} className={`rounded-full px-3 py-1 text-label ${status === f.value ? "bg-primary text-on-primary" : "bg-surface text-ink-secondary hover:text-ink"}`}>
            {f.label}
          </Link>
        ))}
      </nav>
      {lines.length === 0 ? (
        <EmptyState title="No bank lines here">Import a statement to start matching.</EmptyState>
      ) : (
        <Table label="Bank lines">
          <THead><TR><TH>Date</TH><TH>Description</TH><TH className="text-right">Amount</TH><TH>Match</TH></TR></THead>
          <TBody>
            {lines.map((line) => (
              <TR key={line.id}>
                <TD className="whitespace-nowrap tabular-nums">{line.postedOn}</TD>
                <TD>
                  {line.description}
                  {line.reference ? <span className="block text-caption text-ink-muted">{line.reference}</span> : null}
                </TD>
                <TD className={`whitespace-nowrap text-right font-semibold tabular-nums ${line.amountMinor < 0 ? "" : "text-success-fg"}`}>
                  {line.amountMinor < 0 ? "-" : "+"}{formatMoney(Math.abs(line.amountMinor), line.currency)}
                </TD>
                <TD><BankLineActions slug={slug} line={line} options={options} canManage={canManage} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { Callout, Card, CardHeader } from "@/components/ui/display";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ACCOUNTING_FORMATS, FORMAT_INFO, HELP_NOTE, type AccountingFormat, type UnmappedEntry } from "@/lib/finance/accounting-export/types";
import { formatMoney } from "@/lib/format/money";

export type ExportPanelProps = {
  slug: string;
  currency: string;
  format: AccountingFormat;
  from: string;
  to: string;
  accountId: string;
  journalLedger: string;
  accounts: { id: string; name: string }[];
  rowCount: number;
  unmapped: UnmappedEntry[];
  error: string | null;
};

/** Filters, a preview of what will export, the unmapped list and the download link. Plain GET form: no client code. */
export function AccountingExportPanel(p: ExportPanelProps) {
  const info = FORMAT_INFO[p.format];
  const query = new URLSearchParams({ from: p.from, to: p.to });
  if (p.accountId) query.set("account", p.accountId);
  if (p.journalLedger) query.set("journalLedger", p.journalLedger);
  if (p.unmapped.length) query.set("partial", "1");
  const href = `/w/${p.slug}/finance/export/accounting/${p.format}?${query.toString()}`;
  return (
    <div className="flex flex-col gap-5">
      <Card padding="lg">
        <CardHeader title="Choose what to export" description={`${info.description} ${HELP_NOTE}`} />
        <form method="get" className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Format">
            <Dropdown name="format" defaultValue={p.format}>
              {ACCOUNTING_FORMATS.map((f) => <option key={f} value={f}>{FORMAT_INFO[f].label}</option>)}
            </Dropdown>
          </Field>
          <Field label="Bank account" optional={!info.needsAccount} helperText={info.needsAccount ? "Statement layouts hold one account at a time." : undefined}>
            <Dropdown name="account" defaultValue={p.accountId}>
              <option value="">{info.needsAccount ? "Choose an account" : "All accounts"}</option>
              {p.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Dropdown>
          </Field>
          <Field label="From"><Input type="date" name="from" defaultValue={p.from} required /></Field>
          <Field label="To"><Input type="date" name="to" defaultValue={p.to} required /></Field>
          {p.format === "tally" || p.format === "journal" ? (
            <Field label="Ledger for entries with no bank account" optional helperText="Entries without an account export as Journal vouchers against this ledger. Leave blank to list them as unmapped.">
              <Input name="journalLedger" defaultValue={p.journalLedger} maxLength={100} />
            </Field>
          ) : null}
          <div className="flex items-end sm:col-span-2"><Button type="submit" variant="secondary">Update preview</Button></div>
        </form>
      </Card>
      {p.error ? (
        <Callout tone="danger" title="That export can't be prepared." role="alert">{p.error}</Callout>
      ) : (
        <>
          <Callout tone={p.unmapped.length ? "warning" : "success"} title={`${p.rowCount} ${p.rowCount === 1 ? "entry is" : "entries are"} ready to export${p.unmapped.length ? `; ${p.unmapped.length} unmapped ${p.unmapped.length === 1 ? "entry is" : "entries are"} left out` : ""}.`}>
            Payroll postings are never included. Entries are never given a guessed ledger.
          </Callout>
          {p.rowCount > 0 ? (
            <div><Button asChild variant="primary"><a href={href}>Download {info.label}{p.unmapped.length ? " (mapped entries only)" : ""}</a></Button></div>
          ) : null}
          {p.unmapped.length ? (
            <Table label="Unmapped entries">
              <THead><TR><TH>Date</TH><TH>Description</TH><TH className="text-right">Amount</TH><TH>Why</TH></TR></THead>
              <TBody>
                {p.unmapped.slice(0, 100).map((u) => (
                  <TR key={u.id}>
                    <TD className="whitespace-nowrap tabular-nums">{u.date}</TD>
                    <TD>{u.description}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">{u.kind === "INCOME" ? "+" : "-"}{formatMoney(u.amountMinor, p.currency)}</TD>
                    <TD className="text-ink-secondary">{u.reason}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : null}
        </>
      )}
    </div>
  );
}

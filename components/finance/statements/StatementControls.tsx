import { Button } from "@/components/ui/button";
import { Field, Dropdown } from "@/components/ui/field";
import { STATEMENT_KINDS, STATEMENT_TITLES } from "@/lib/finance/statements/export";
import type { StatementData } from "@/lib/finance/statements/load";

/** Year and currency picker (a plain GET form) plus CSV, PDF and print links. */
export function StatementControls({ base, data }: { base: string; data: StatementData }) {
  const q = `year=${data.range.year}&currency=${data.currency}`;
  return (
    <div className="flex flex-col gap-4 print:hidden">
      <form method="get" action={base} className="flex flex-wrap items-end gap-3">
        <Field label="Financial year"><Dropdown name="year" defaultValue={String(data.range.year)}>{data.years.map((y) => <option key={y.year} value={y.year}>{y.label}</option>)}</Dropdown></Field>
        <Field label="Currency"><Dropdown name="currency" defaultValue={data.currency}>{data.currencies.map((c) => <option key={c} value={c}>{c}</option>)}</Dropdown></Field>
        <Button type="submit" variant="secondary">Show</Button>
        <Button asChild variant="secondary"><a href={`${base}/print?${q}`} target="_blank" rel="noreferrer">Print view</a></Button>
      </form>
      <p className="text-caption text-ink-muted">{data.range.from} to {data.range.to}. Downloads:</p>
      <div className="flex flex-wrap gap-2">
        {STATEMENT_KINDS.flatMap((k) => (["csv", "pdf"] as const).map((f) => (
          <Button key={`${k}-${f}`} asChild variant="secondary"><a href={`${base}/export/${k}?format=${f}&${q}`}>{STATEMENT_TITLES[k]} {f.toUpperCase()}</a></Button>
        )))}
      </div>
    </div>
  );
}

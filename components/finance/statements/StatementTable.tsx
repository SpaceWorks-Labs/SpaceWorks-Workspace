import { Card, CardHeader } from "@/components/ui/display";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatMoney } from "@/lib/format/money";

export type StatementRow = { name: string; cells: number[]; strong?: boolean; note?: string };

/** One statement table. Money cells are right-aligned and the last row can be a bold total. */
export function StatementTable({ title, firstHead, heads, rows, currency, empty }: { title: string; firstHead: string; heads: string[]; rows: StatementRow[]; currency: string; empty?: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length ? (
        <Table label={title}>
          <THead>
            <TR>
              <TH scope="col">{firstHead}</TH>
              {heads.map((h) => <TH key={h} scope="col" className="text-right">{h}</TH>)}
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.name}>
                <TD className={r.strong ? "font-semibold" : undefined}>{r.name}{r.note ? <span className="ml-2 text-caption text-ink-muted">{r.note}</span> : null}</TD>
                {r.cells.map((c, i) => <TD key={i} className={`text-right tabular-nums ${r.strong ? "font-semibold" : ""}`}>{formatMoney(c, currency)}</TD>)}
              </TR>
            ))}
          </TBody>
        </Table>
      ) : <p className="text-ink-muted">{empty ?? "Nothing recorded in this year."}</p>}
    </Card>
  );
}

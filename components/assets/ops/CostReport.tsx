import { Card, CardHeader } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { buttonClasses } from "@/components/ui/button";
import { formatMoney } from "@/lib/format/money";
import type { CostRow } from "@/lib/makerspace/downtime";

/** Downtime and maintenance spend per asset for a period (admin only; the page checks). */
export function CostReport({ rows, from, to, currency }: { rows: CostRow[]; from: string; to: string; currency: string }) {
  return (
    <Card>
      <CardHeader title="Downtime and maintenance cost" description="Hours out of service and maintenance spend per machine in the period." />
      <form className="my-3 flex flex-wrap items-end gap-3" action="">
        <label className="text-label">From<input type="date" name="from" defaultValue={from} className="mt-1 block min-h-11 rounded-md border border-line bg-panel px-3" /></label>
        <label className="text-label">To<input type="date" name="to" defaultValue={to} className="mt-1 block min-h-11 rounded-md border border-line bg-panel px-3" /></label>
        <button className={buttonClasses({ variant: "secondary" })}>Update</button>
      </form>
      {rows.length ? (
        <Table label="Downtime and maintenance cost by asset">
          <THead><TR><TH>Machine</TH><TH>Downtime events</TH><TH>Hours down</TH><TH>Maintenance jobs</TH><TH>Maintenance cost</TH></TR></THead>
          <TBody>
            {rows.map((r) => <TR key={r.assetId}><TD>{r.name}</TD><TD>{r.downtimeCount}</TD><TD>{r.downtimeHours.toFixed(1)}</TD><TD>{r.maintenanceCount}</TD><TD>{formatMoney(r.maintenanceCostMinor, currency)}</TD></TR>)}
          </TBody>
        </Table>
      ) : <p className="text-body-ui text-ink-muted">No downtime or maintenance in this period.</p>}
    </Card>
  );
}

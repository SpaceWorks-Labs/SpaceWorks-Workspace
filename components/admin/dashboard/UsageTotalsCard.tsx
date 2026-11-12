import { Card, CardHeader, DetailList, EmptyState } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { compactNumber, trendText } from "@/lib/admin/dashboard/compute";
import type { UsageTotals } from "@/lib/admin/dashboard/types";
import { formatBytes } from "@/lib/limits/format";
import { formatMoney } from "@/lib/format/money";

const PROVIDER_LABEL = { STRIPE: "Stripe", RAZORPAY: "Razorpay" } as const;
const STATUS_LABEL: Record<string, string> = {
  CREATED: "Waiting", PAID: "Paid", FAILED: "Failed", EXPIRED: "Expired", REFUNDED: "Refunded", PARTIALLY_REFUNDED: "Partly refunded", NEEDS_REVIEW: "Needs review",
};

function Metric({ value, hint }: { value: string; hint: string }) {
  return (
    <span className="flex flex-col">
      <span className="font-semibold tabular-nums text-ink">{value}</span>
      <span className="text-caption text-ink-muted">{hint}</span>
    </span>
  );
}

export function UsageTotalsCard({ totals, range }: { totals: UsageTotals; range: number }) {
  return (
    <Card as="section" aria-label="Instance usage" className="min-w-0">
      <CardHeader title="Instance usage" description={`Totals for the last ${range} days across every organisation.`} />
      <DetailList
        items={[
          { label: "Campaign emails sent", value: <Metric value={compactNumber(totals.campaignSent.current)} hint={trendText(totals.campaignSent, range)} /> },
          { label: "System emails sent", value: <Metric value={compactNumber(totals.transactionalSent.current)} hint={`${trendText(totals.transactionalSent, range)}. Outbox mail such as invitations, notifications and account emails.`} /> },
          { label: "Assistant tokens", value: <Metric value={compactNumber(totals.assistantUsed.current)} hint={trendText(totals.assistantUsed, range)} /> },
          { label: "Tasks created", value: <Metric value={compactNumber(totals.tasksCreated.current)} hint={trendText(totals.tasksCreated, range)} /> },
          { label: "Storage in use", value: <Metric value={formatBytes(totals.storageBytes)} hint="Now, including kept versions" /> },
          { label: "Open projects", value: <Metric value={compactNumber(totals.openProjects)} hint="Now, not archived" /> },
        ]}
      />
      {totals.transactionalByKind.length ? (
        <p className="mt-3 text-caption text-ink-muted">
          System email by kind: {totals.transactionalByKind.map((row) => `${row.kind} ${compactNumber(row.count)}`).join(", ")}.
        </p>
      ) : null}
      <h3 className="mt-6 mb-3 text-label text-ink">Invoice payments</h3>
      {totals.payments.length ? (
        <Table label="Payments by provider and currency">
          <THead>
            <tr><TH>Provider</TH><TH>Currency</TH><TH>Paid</TH><TH>Amount</TH><TH>Refunded</TH></tr>
          </THead>
          <TBody>
            {totals.payments.map((row) => (
              <TR key={`${row.provider}-${row.currency}`}>
                <TD>{PROVIDER_LABEL[row.provider]}</TD>
                <TD>{row.currency}</TD>
                <TD className="tabular-nums">{row.paidCount}</TD>
                <TD className="whitespace-nowrap tabular-nums">{formatMoney(row.paidMinor, row.currency)}</TD>
                <TD className="whitespace-nowrap tabular-nums">{formatMoney(row.refundedMinor, row.currency)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState className="border-0 px-0" title={`No invoice payments in the last ${range} days.`} />
      )}
      {totals.paymentLinks.length ? (
        <p className="mt-3 text-caption text-ink-muted">
          Payment links created: {totals.paymentLinks.map((row) => `${STATUS_LABEL[row.status] ?? row.status} ${row.count}`).join(", ")}.
        </p>
      ) : null}
    </Card>
  );
}

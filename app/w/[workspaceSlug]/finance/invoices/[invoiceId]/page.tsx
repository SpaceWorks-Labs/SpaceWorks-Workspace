import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceActions } from "@/components/finance/InvoiceActions";
import { InvoiceDocument } from "@/components/finance/InvoiceDocument";
import { InvoicePaymentPanel } from "@/components/payments/InvoicePaymentPanel";
import { Callout } from "@/components/ui/display";
import { formatDay, localDate } from "@/lib/finance/dates";
import { isInvoiceOverdue, parseInvoiceItems } from "@/lib/finance/invoice";
import { getInvoice, listCategories } from "@/lib/finance/queries";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";
import { connectedProviders } from "@/lib/payments/accounts";
import { listInvoicePayments } from "@/lib/payments/links";
import { idSchema } from "@/lib/validation";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/w/[workspaceSlug]/finance/invoices/[invoiceId]">) {
  const { workspaceSlug, invoiceId } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewFinance(membership, workspace) || !idSchema.safeParse(invoiceId).success) notFound();
  const invoice = await getInvoice(workspace.id, invoiceId);
  if (!invoice) notFound();
  const manage = canManageFinance(membership);
  const today = localDate(new Date(), workspace.timezone);
  const overdue = isInvoiceOverdue(invoice, today);
  const listHref = `/w/${workspace.slug}/finance/invoices`;
  const [payments, providers] = manage ? await Promise.all([listInvoicePayments(workspace.id, invoice.id), connectedProviders(workspace.id)]) : [[], []];
  const incomeCategories = manage ? (await listCategories(workspace.id)).filter((c) => c.kind === "INCOME") : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <Link href={listHref} className="text-label text-ink-secondary underline-offset-4 hover:underline">
          ← Back to invoices
        </Link>
        <InvoiceActions
          slug={workspace.slug}
          invoiceId={invoice.id}
          number={invoice.number}
          status={invoice.status}
          clientEmail={manage ? invoice.clientEmail : null}
          canManage={manage}
          today={today}
          incomeCategories={incomeCategories.map((c) => ({ id: c.id, name: c.name }))}
          listHref={listHref}
        />
      </div>
      {manage ? <p className="print:hidden"><Link className="inline-flex min-h-11 items-center text-accent-text underline" href={`/w/${workspace.slug}/documents/new?sourceType=INVOICE&sourceId=${invoice.id}`}>Prepare a controlled document from this legacy invoice</Link></p> : null}
      {overdue ? (
        <Callout tone="warning" title="This invoice is overdue." role="status">
          It was due {formatDay(invoice.dueOn!)}. Email it again or mark it paid when the money arrives.
        </Callout>
      ) : null}
      {invoice.ledgerEntry ? (
        <p className="text-body-ui text-ink-secondary print:hidden">
          {invoice.ledgerEntry.voidedAt ? "Its ledger entry was voided with the invoice." : (
            <>
              Recorded on the{" "}
              <Link href={`/w/${workspace.slug}/finance/ledger?q=${encodeURIComponent(invoice.number)}`} className="text-accent-text underline underline-offset-4">
                ledger
              </Link>{" "}
              on {formatDay(invoice.ledgerEntry.occurredOn)}.
            </>
          )}
        </p>
      ) : null}
      {manage ? <InvoicePaymentPanel slug={workspace.slug} invoiceId={invoice.id} invoiceStatus={invoice.status} providers={providers} payments={payments} /> : null}
      <InvoiceDocument
        workspaceName={workspace.name}
        overdue={overdue}
        invoice={{ ...invoice, clientEmail: manage ? invoice.clientEmail : null, items: parseInvoiceItems(invoice.items) }}
      />
    </div>
  );
}

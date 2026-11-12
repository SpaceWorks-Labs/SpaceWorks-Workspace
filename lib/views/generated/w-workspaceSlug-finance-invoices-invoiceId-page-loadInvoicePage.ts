// Generated from app/w/[workspaceSlug]/finance/invoices/[invoiceId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { localDate } from "@/lib/finance/dates";
import { isInvoiceOverdue } from "@/lib/finance/invoice";
import { getInvoice, listCategories } from "@/lib/finance/queries";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";
import { connectedProviders } from "@/lib/payments/accounts";
import { listInvoicePayments } from "@/lib/payments/links";
import { idSchema } from "@/lib/validation";

export async function loadInvoicePage({ params }: PageProps<"/w/[workspaceSlug]/finance/invoices/[invoiceId]">) {
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
return viewDto({ workspace, invoice, manage, today, overdue, listHref, payments, providers, incomeCategories } as const);
}

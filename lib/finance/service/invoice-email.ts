import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { RenderedEmail } from "@/lib/email/templates";
import { EMAIL_BUTTON_STYLE } from "@/lib/email/brand";
import { escapeHtml, renderNotificationEmail } from "@/lib/email/templates";
import { formatMoney } from "@/lib/format/money";
import { parseInvoiceItems } from "@/lib/finance/invoice";
import { invoiceTotals, lineSubtotalMinor } from "@/lib/finance/money";

// ───────────── Invoice email ─────────────

export function renderInvoiceEmail(invoice: {
  number: string;
  clientName: string;
  issuedOn: Date;
  dueOn: Date | null;
  currency: string;
  items: Prisma.JsonValue;
  totalMinor: number;
  notes: string | null;
  workspaceName: string;
  timeZone: string;
  /** Provider-hosted pay link (https only). Rendered into the body, never stored as a separate field. */
  payUrl?: string | null;
}) {
  const items = parseInvoiceItems(invoice.items);
  const totals = invoiceTotals(items);
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const day = (date: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  const rows = items
    .map((item) => `<tr><td style="padding:6px 0">${escapeHtml(item.description)}</td><td style="padding:6px 8px;text-align:right">${item.quantity}</td><td style="padding:6px 0;text-align:right">${escapeHtml(money(lineSubtotalMinor(item)))}</td></tr>`)
    .join("");
  const payUrl = invoice.payUrl && invoice.payUrl.startsWith("https://") ? invoice.payUrl : null;
  const bodyHtml = [
    `<p>Hello ${escapeHtml(invoice.clientName)},</p>`,
    `<p>Here is invoice <strong>${escapeHtml(invoice.number)}</strong> from ${escapeHtml(invoice.workspaceName)}, issued ${escapeHtml(day(invoice.issuedOn))}${invoice.dueOn ? `, due ${escapeHtml(day(invoice.dueOn))}` : ""}.</p>`,
    `<table style="width:100%;border-collapse:collapse"><thead><tr><th scope="col" style="text-align:left">Item</th><th scope="col" style="text-align:right;padding:0 8px">Qty</th><th scope="col" style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>`,
    totals.taxMinor ? `<p>Subtotal ${escapeHtml(money(totals.subtotalMinor))} · Tax ${escapeHtml(money(totals.taxMinor))}</p>` : "",
    `<p><strong>Total due: ${escapeHtml(money(totals.totalMinor))}</strong></p>`,
    payUrl ? `<p><a href="${escapeHtml(payUrl)}" style="${EMAIL_BUTTON_STYLE}">Pay this invoice online</a></p>` : "",
    invoice.notes ? `<p>${escapeHtml(invoice.notes).replace(/\n/g, "<br>")}</p>` : "",
  ].join("");
  const subject = `Invoice ${invoice.number} from ${invoice.workspaceName}`;
  const rendered = renderNotificationEmail({ title: subject, bodyHtml });
  const text = [
    `Hello ${invoice.clientName},`,
    "",
    `Here is invoice ${invoice.number} from ${invoice.workspaceName}, issued ${day(invoice.issuedOn)}${invoice.dueOn ? `, due ${day(invoice.dueOn)}` : ""}.`,
    "",
    ...items.map((item) => `- ${item.description} × ${item.quantity}: ${money(lineSubtotalMinor(item))}`),
    "",
    ...(totals.taxMinor ? [`Subtotal ${money(totals.subtotalMinor)} · Tax ${money(totals.taxMinor)}`] : []),
    `Total due: ${money(totals.totalMinor)}`,
    ...(payUrl ? ["", `Pay online: ${payUrl}`] : []),
    ...(invoice.notes ? ["", invoice.notes] : []),
  ].join("\n");
  return { subject, html: rendered.html, text };
}

const invoiceJobSchema = z.object({ workspaceId: z.string().min(1), invoiceId: z.string().min(1), to: z.email() });

/**
 * Outbox renderer for kind "invoice.email": reads the invoice and its newest
 * open pay link now, so the link lives only on the InvoicePayment row. A
 * missing, void or archived-workspace invoice is dropped ("expired").
 */
export async function renderInvoiceOutboxEmail(raw: unknown): Promise<{ to: string; email: RenderedEmail } | "expired"> {
  const job = invoiceJobSchema.parse(raw);
  const invoice = await prisma.invoice.findFirst({ where: { id: job.invoiceId, workspaceId: job.workspaceId, workspace: { status: "ACTIVE", archivedAt: null } }, include: { workspace: { select: { name: true, timezone: true } } } });
  if (!invoice || invoice.status === "VOID") return "expired";
  const pay = invoice.status === "SENT"
    ? await prisma.invoicePayment.findFirst({ where: { workspaceId: job.workspaceId, invoiceId: invoice.id, status: "CREATED", url: { not: null } }, orderBy: { createdAt: "desc" }, select: { url: true } })
    : null;
  const email = renderInvoiceEmail({ ...invoice, workspaceName: invoice.workspace.name, timeZone: invoice.workspace.timezone, payUrl: pay?.url });
  return { to: job.to, email };
}

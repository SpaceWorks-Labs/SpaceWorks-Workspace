import "server-only";
import type { InvoicePaymentStatus, PaymentProvider } from "@prisma/client";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { checkRateLimitById } from "@/lib/rateLimit";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format/money";
import type { WorkspaceContext } from "@/lib/permissions";
import { openCredentials, PROVIDER_LABEL, type RazorpayCredentials, type StripeCredentials } from "./credentials";
import { createRazorpayLink, refundRazorpay } from "./razorpay";
import { createStripeCheckout, refundStripe, type ProviderResult } from "./stripe";

type Ctx = Pick<WorkspaceContext, "user" | "workspace">;
const REUSE_MS = 20 * 60 * 60_000;
const GONE = "That invoice isn't available any more. Refresh and try again.";

export type InvoicePaymentView = { id: string; provider: PaymentProvider; status: InvoicePaymentStatus; url: string | null; amountMinor: number; currency: string; refundedMinor: number; paidAt: string | null; lastError: string | null; createdAt: string };

export async function listInvoicePayments(workspaceId: string, invoiceId: string): Promise<InvoicePaymentView[]> {
  const rows = await prisma.invoicePayment.findMany({ where: { workspaceId, invoiceId }, orderBy: { createdAt: "desc" }, take: 20 });
  return rows.map((row) => ({ id: row.id, provider: row.provider, status: row.status, url: row.status === "CREATED" ? row.url : null, amountMinor: row.amountMinor, currency: row.currency, refundedMinor: row.refundedMinor, paidAt: row.paidAt?.toISOString() ?? null, lastError: row.lastError, createdAt: row.createdAt.toISOString() }));
}

/** Create (or reuse a recent) hosted payment link for a SENT invoice. */
export async function createInvoicePaymentLink(ctx: Ctx, invoiceId: string, provider: PaymentProvider): Promise<ActionResult<{ url: string }>> {
  const workspaceId = ctx.workspace.id;
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId } });
  if (!invoice) return actionError(GONE);
  if (invoice.status !== "SENT") return actionError("Send the invoice first. Only sent invoices can take online payment.");
  if (invoice.totalMinor <= 0) return actionError("This invoice has nothing to pay.");
  if (provider === "RAZORPAY" && invoice.currency !== "INR") return actionError("Razorpay payment links support INR only. Use Stripe for this invoice.");
  const account = await prisma.paymentProviderAccount.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
  const credentials = account && account.status === "ACTIVE" ? openCredentials(provider, account.credentialsEnc) : null;
  if (!credentials) return actionError(`Connect ${PROVIDER_LABEL[provider]} in Settings, Payments first.`);
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  if (provider === "STRIPE" && !base) return actionError("Set the public base URL for this instance before creating Stripe links.");
  const recent = await prisma.invoicePayment.findFirst({ where: { workspaceId, invoiceId, provider, status: "CREATED", url: { not: null }, amountMinor: invoice.totalMinor, currency: invoice.currency, createdAt: { gt: new Date(Date.now() - REUSE_MS) } }, orderBy: { createdAt: "desc" } });
  if (recent?.url) return { ok: true, data: { url: recent.url } };

  const payment = await prisma.invoicePayment.create({ data: { workspaceId, invoiceId, provider, amountMinor: invoice.totalMinor, currency: invoice.currency } });
  const description = `Invoice ${invoice.number} from ${ctx.workspace.name}`;
  const now = Math.floor(Date.now() / 1000);
  const created: ProviderResult<{ id: string; url: string }> = provider === "STRIPE"
    ? await createStripeCheckout(credentials as StripeCredentials, { paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency, description, customerEmail: invoice.clientEmail, returnUrl: base, expiresAt: now + 23 * 3600 })
    : await createRazorpayLink(credentials as RazorpayCredentials, { paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency, description, customerEmail: invoice.clientEmail, expireBy: now + 14 * 86400 });
  if (!created.ok) {
    await prisma.invoicePayment.update({ where: { id: payment.id }, data: { status: "FAILED", lastError: created.error.slice(0, 300) } });
    return actionError(`Couldn't create the payment link. ${created.error}`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.invoicePayment.update({ where: { id: payment.id }, data: { externalLinkId: created.data.id, url: created.data.url } });
    await recordAuditEvent({ action: "payments.link_created", workspaceId, actorId: ctx.user.id, targetType: "invoice", targetId: invoiceId, metadata: { provider, paymentId: payment.id }, client: tx });
  });
  return { ok: true, data: { url: created.data.url } };
}

/** Ask the provider to refund. The webhook is the single writer of refunded amounts, so nothing is double counted. */
export async function refundInvoicePayment(ctx: Ctx, paymentId: string, amountMinor?: number): Promise<ActionResult> {
  const workspaceId = ctx.workspace.id;
  const payment = await prisma.invoicePayment.findFirst({ where: { id: paymentId, workspaceId } });
  if (!payment || !payment.externalPaymentId || !["PAID", "PARTIALLY_REFUNDED"].includes(payment.status)) return actionError("Only a paid online payment can be refunded.");
  const remaining = payment.amountMinor - payment.refundedMinor;
  const amount = amountMinor ?? remaining;
  if (!Number.isInteger(amount) || amount < 1 || amount > remaining) return actionError(`Enter an amount up to ${formatMoney(remaining, payment.currency)}.`);
  if (!(await checkRateLimitById("paymentRefund", payment.id))) return actionError("A refund for this payment was just requested. Wait a minute for the provider to confirm it, then check again.");
  const account = await prisma.paymentProviderAccount.findUnique({ where: { workspaceId_provider: { workspaceId, provider: payment.provider } } });
  const credentials = account ? openCredentials(payment.provider, account.credentialsEnc) : null;
  if (!credentials) return actionError(`Connect ${PROVIDER_LABEL[payment.provider]} in Settings, Payments first.`);
  const result = payment.provider === "STRIPE"
    ? await refundStripe(credentials as StripeCredentials, { paymentIntentId: payment.externalPaymentId, amountMinor: amount, idempotencyKey: `sww-refund-${payment.id}-${payment.refundedMinor}-${amount}` })
    : await refundRazorpay(credentials as RazorpayCredentials, { paymentId: payment.externalPaymentId, amountMinor: amount });
  if (!result.ok) return actionError(`The refund didn't go through. ${result.error}`);
  await recordAuditEvent({ action: "payments.refund_requested", workspaceId, actorId: ctx.user.id, targetType: "invoice", targetId: payment.invoiceId, metadata: { provider: payment.provider, paymentId: payment.id, amountMinor: amount } });
  return { ok: true };
}

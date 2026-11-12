import "server-only";
import type { InvoicePayment, PaymentProviderAccount, Prisma } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { localDate } from "@/lib/finance/dates";
import { settleInvoiceFromPayment } from "@/lib/finance/service/invoices";
import { dispatch } from "@/lib/notify";
import type { PaymentEvent } from "./events";

type Tx = Prisma.TransactionClient;
export type Applied = { status: string; afterCommit: Array<() => Promise<unknown>> };

async function findPayment(tx: Tx, account: PaymentProviderAccount, event: PaymentEvent) {
  const scope = { workspaceId: account.workspaceId, provider: account.provider };
  // Most specific key first: our own reference, then the provider's ids.
  const keys: Prisma.InvoicePaymentWhereInput[] = [];
  if (event.paymentRef) keys.push({ id: event.paymentRef });
  if (event.linkId) keys.push({ externalLinkId: event.linkId });
  if (event.externalPaymentId) keys.push({ externalPaymentId: event.externalPaymentId });
  let found: { id: string } | null = null;
  for (const key of keys) {
    found = await tx.invoicePayment.findFirst({ where: { ...scope, ...key }, select: { id: true } });
    if (found) break;
  }
  if (!found) return null;
  await tx.$queryRaw`SELECT "id" FROM "InvoicePayment" WHERE "id" = ${found.id} FOR UPDATE`;
  return tx.invoicePayment.findFirst({ where: { id: found.id, ...scope } });
}

async function admins(tx: Tx, workspaceId: string) {
  const rows = await tx.membership.findMany({ where: { workspaceId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] }, user: { disabledAt: null } }, select: { userId: true } });
  return rows.map((row) => row.userId);
}

/**
 * Apply one verified, de-duplicated provider event inside the caller's
 * transaction. Every lookup is scoped to the account's workspace, so a token
 * from one workspace can never touch another's invoices.
 */
export async function applyPaymentEvent(tx: Tx, account: PaymentProviderAccount, event: PaymentEvent): Promise<Applied> {
  const done = (status: string, afterCommit: Applied["afterCommit"] = []): Applied => ({ status, afterCommit });
  const payment = await findPayment(tx, account, event);
  if (!payment) return done("IGNORED_UNKNOWN_PAYMENT");
  const workspaceId = account.workspaceId;
  const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true, timezone: true } });
  const invoice = await tx.invoice.findFirst({ where: { id: payment.invoiceId, workspaceId }, select: { id: true, number: true } });
  const url = `/w/${workspace.slug}/finance/invoices/${payment.invoiceId}`;
  const recipients = await admins(tx, workspaceId);
  const common = { url, recipients, resource: { type: "invoice", id: payment.invoiceId } };
  const label = invoice?.number ?? "An invoice";
  const base = { invoiceId: payment.invoiceId, paymentId: payment.id, provider: account.provider };
  const notify = async (run: () => ReturnType<typeof dispatch>) => { const result = await run(); return result.afterCommit; };

  if (event.kind === "expired") {
    if (payment.status === "CREATED") await tx.invoicePayment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } });
    return done("EXPIRED");
  }
  if (event.kind === "failed") {
    if (payment.status !== "CREATED") return done("IGNORED_STATE");
    const reason = event.reason ?? "The payment failed.";
    await tx.invoicePayment.update({ where: { id: payment.id }, data: { status: "FAILED", lastError: reason } });
    return done("FAILED", [await notify(() => dispatch(workspaceId, { ...common, type: "finance.payment.failed", title: `Online payment failed for ${label}`, data: { ...base, reason } }, { tx }))]);
  }
  if (event.kind === "refunded") return refunded(tx, payment, event, account, notify, common, label);
  return paid(tx, payment, event, account, notify, common, label, workspace.timezone, done);
}

type Common = { url: string; recipients: string[]; resource: { type: string; id: string } };
type Notify = (run: () => ReturnType<typeof dispatch>) => Promise<() => Promise<unknown>>;

async function refunded(tx: Tx, payment: InvoicePayment, event: PaymentEvent, account: PaymentProviderAccount, notify: Notify, common: Common, label: string): Promise<Applied> {
  if (!["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status) || event.refundedMinor === null) return { status: "IGNORED_STATE", afterCommit: [] };
  const refundedMinor = Math.min(payment.amountMinor, Math.max(payment.refundedMinor, event.refundedMinor));
  if (refundedMinor === payment.refundedMinor) return { status: "DUPLICATE_REFUND", afterCommit: [] };
  const status = refundedMinor >= payment.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
  await tx.invoicePayment.update({ where: { id: payment.id }, data: { status, refundedMinor } });
  await recordAuditEvent({ action: "payments.refunded", workspaceId: account.workspaceId, targetType: "invoice", targetId: payment.invoiceId, metadata: { provider: account.provider, refundedMinor, currency: payment.currency }, client: tx });
  const after = await notify(() => dispatch(account.workspaceId, { ...common, type: "finance.payment.refunded", title: `Online payment refunded for ${label}`, data: { invoiceId: payment.invoiceId, paymentId: payment.id, refundedMinor, currency: payment.currency, provider: account.provider } }, { tx }));
  return { status, afterCommit: [after] };
}

async function paid(tx: Tx, payment: InvoicePayment, event: PaymentEvent, account: PaymentProviderAccount, notify: Notify, common: Common, label: string, timezone: string, done: (status: string, after?: Applied["afterCommit"]) => Applied): Promise<Applied> {
  const workspaceId = account.workspaceId;
  if (payment.status === "PAID" || payment.status === "REFUNDED" || payment.status === "PARTIALLY_REFUNDED") return done("DUPLICATE_PAID");
  const externalPaymentId = event.externalPaymentId ?? payment.externalPaymentId;
  const clash = externalPaymentId ? await tx.invoicePayment.findFirst({ where: { provider: account.provider, externalPaymentId, NOT: { id: payment.id } }, select: { id: true } }) : null;
  if (clash) return done("IGNORED_CONFLICT");
  const now = new Date();
  const mismatch = event.amountMinor !== payment.amountMinor || event.currency !== payment.currency;
  const outcome = mismatch
    ? { status: "REVIEW" as const, reason: "The amount paid does not match the payment link." }
    : await settleInvoiceFromPayment(tx, { workspaceId, invoiceId: payment.invoiceId, amountMinor: payment.amountMinor, currency: payment.currency, paidOn: localDate(now, timezone), provider: account.provider, paymentId: payment.id });
  const settled = outcome.status === "PAID";
  await tx.invoicePayment.update({ where: { id: payment.id }, data: { status: settled ? "PAID" : "NEEDS_REVIEW", paidAt: now, externalPaymentId, lastError: settled ? null : outcome.reason } });
  const data = { invoiceId: payment.invoiceId, paymentId: payment.id, provider: account.provider };
  if (settled) {
    return done("PAID", [await notify(() => dispatch(workspaceId, { ...common, type: "finance.invoice.paid", title: `${label} was paid online`, data: { ...data, amountMinor: payment.amountMinor, currency: payment.currency } }, { tx }))]);
  }
  await recordAuditEvent({ action: "payments.needs_review", workspaceId, targetType: "invoice", targetId: payment.invoiceId, metadata: { provider: account.provider, paymentId: payment.id }, client: tx });
  return done("NEEDS_REVIEW", [await notify(() => dispatch(workspaceId, { ...common, type: "finance.payment.failed", title: `Payment for ${label} needs review`, data: { ...data, reason: outcome.reason } }, { tx }))]);
}

import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@/lib/permissions";

const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.id ? { user: { id: session.id } } : null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string; text: string; workspaceId: string | null }[]);
vi.mock("@/lib/email/send", () => ({ sendRenderedEmail: async (to: string, email: { subject: string; html: string; text: string }, _id: string, workspaceId: string | null = null) => { sent.push({ to, subject: email.subject, html: email.html, text: email.text, workspaceId }); } }));

import { prisma } from "@/lib/db";
import { getWorkspaceForAction } from "@/lib/permissions";
import { invoiceSchema } from "@/lib/finance/schemas";
import * as finance from "@/lib/finance/service";
import { savePaymentAccountAction } from "@/app/actions/payments";
import { listAccounts, saveAccount } from "@/lib/payments/accounts";
import { createInvoicePaymentLink } from "@/lib/payments/links";
import { receivePaymentWebhook } from "@/lib/payments/webhook";
import { deliverOutboxBatch } from "@/lib/outbox";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@payments-${suffix}.test`;
const slugA = `pay-a-${suffix}`;
const slugB = `pay-b-${suffix}`;
const SECRET_KEY = "sk_test_PaymentsSecretKey123";
const WHSEC = "whsec_PaymentsSigningSecret1";
let ctxA: WorkspaceContext;
let ctxB: WorkspaceContext;
let tokenA = "";
let tokenB = "";
const users: Record<string, string> = {};

const values = invoiceSchema.parse({ clientName: "Maker partner", clientEmail: `client${domain}`, issuedOn: "2026-10-01", dueOn: "2026-10-18", items: [{ description: "Workshop", quantity: 1, unitPrice: "100" }] });

let linkCounter = 0;
function stubStripe() {
  vi.stubGlobal("fetch", vi.fn(async () => { const count = ++linkCounter; return new Response(JSON.stringify({ id: `cs_${suffix}_${count}`, url: `https://checkout.stripe.com/c/pay/cs_${count}` }), { status: 200 }); }));
}
async function sentInvoice(ctx: WorkspaceContext = ctxA) {
  const created = await finance.createInvoice(ctx, values);
  if (!created.ok) throw new Error(created.error);
  await finance.sendInvoice(ctx, created.data!.id, { email: false });
  return created.data!.id;
}
async function linkFor(invoiceId: string, ctx: WorkspaceContext = ctxA) {
  stubStripe();
  const result = await createInvoicePaymentLink(ctx, invoiceId, "STRIPE");
  expect(result.ok).toBe(true);
  return prisma.invoicePayment.findFirstOrThrow({ where: { invoiceId }, orderBy: { createdAt: "desc" } });
}
let eventCounter = 0;
function webhook(token: string, payment: { id: string; externalLinkId: string | null }, opts: { type?: string; amount?: number; secret?: string; eventId?: string; ts?: number; paymentIntent?: string } = {}) {
  const body = JSON.stringify({ id: opts.eventId ?? `evt_${suffix}_${++eventCounter}`, type: opts.type ?? "checkout.session.completed", data: { object: { id: payment.externalLinkId, client_reference_id: payment.id, payment_intent: opts.paymentIntent ?? `pi_${suffix}_${payment.id}`, amount_total: opts.amount ?? 10000, currency: "inr", payment_status: "paid" } } });
  const t = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", opts.secret ?? WHSEC).update(`${t}.${body}`).digest("hex");
  return receivePaymentWebhook(new Request("http://localhost/api/payments/stripe/x", { method: "POST", body, headers: { "stripe-signature": `t=${t},v1=${signature}` } }), "stripe", token);
}
const ledger = (invoiceId: string) => prisma.ledgerEntry.count({ where: { sourceType: "invoice", sourceId: invoiceId, workspaceId: ctxA.workspace.id } });

beforeAll(async () => {
  for (const role of ["owner", "admin", "member", "other"]) users[role] = (await createUser(`${role}${domain}`)).id;
  const a = await createWorkspace(slugA, users.owner!);
  await createWorkspace(slugB, users.other!);
  await addMember(a.id, users.admin!, "ADMIN");
  await addMember(a.id, users.member!, "MEMBER");
  session.id = users.owner!;
  ctxA = (await getWorkspaceForAction(slugA))!;
  session.id = users.other!;
  ctxB = (await getWorkspaceForAction(slugB))!;
  expect((await saveAccount(ctxA, "STRIPE", { secretKey: SECRET_KEY, webhookSecret: WHSEC })).ok).toBe(true);
  expect((await saveAccount(ctxB, "STRIPE", { secretKey: "sk_test_OtherWorkspaceKey12", webhookSecret: "whsec_OtherWorkspaceSecret1" })).ok).toBe(true);
  tokenA = (await prisma.paymentProviderAccount.findFirstOrThrow({ where: { workspaceId: ctxA.workspace.id } })).webhookToken;
  tokenB = (await prisma.paymentProviderAccount.findFirstOrThrow({ where: { workspaceId: ctxB.workspace.id } })).webhookToken;
}, 60_000);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await cleanup([slugA, slugB], domain);
  await prisma.$disconnect();
});

describe.sequential("payment credentials", () => {
  it("stores keys encrypted and never exposes them to pages", async () => {
    const row = await prisma.paymentProviderAccount.findFirstOrThrow({ where: { workspaceId: ctxA.workspace.id } });
    expect(row.credentialsEnc).not.toContain(SECRET_KEY);
    expect(row.credentialsEnc).not.toContain(WHSEC);
    expect(JSON.stringify(row.config)).not.toContain("sk_");
    const view = JSON.stringify(await listAccounts(ctxA.workspace.id));
    for (const secret of [SECRET_KEY, WHSEC, row.credentialsEnc]) expect(view).not.toContain(secret);
    expect(view).toContain('"mode":"test"');
    expect(JSON.stringify(await prisma.auditEvent.findMany({ where: { workspaceId: ctxA.workspace.id } }))).not.toContain(SECRET_KEY);
  });
  it("refuses live keys without https and non-admins", async () => {
    session.id = users.owner!;
    const live = await savePaymentAccountAction(slugA, { provider: "STRIPE", secretKey: "sk_live_PaymentsLiveKey1234", webhookSecret: "" });
    expect(live).toMatchObject({ ok: false });
    session.id = users.member!;
    expect(await savePaymentAccountAction(slugA, { provider: "STRIPE", secretKey: "sk_test_PaymentsSecretKey123", webhookSecret: "" })).toMatchObject({ ok: false });
    session.id = users.owner!;
  });
});

describe.sequential("payment webhook", () => {
  it("settles a SENT invoice exactly once and ignores replays", async () => {
    const invoiceId = await sentInvoice();
    const payment = await linkFor(invoiceId);
    expect(payment.url).toContain("https://checkout.stripe.com");
    const eventId = `evt_${suffix}_replay`;
    expect((await webhook(tokenA, payment, { eventId })).status).toBe(200);
    const replay = await webhook(tokenA, payment, { eventId });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });
    expect((await webhook(tokenA, payment, { type: "checkout.session.async_payment_succeeded" })).status).toBe(200);
    expect(await prisma.invoice.findFirstOrThrow({ where: { id: invoiceId } })).toMatchObject({ status: "PAID" });
    expect(await ledger(invoiceId)).toBe(1);
    expect(await prisma.invoicePayment.findFirstOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "PAID", externalPaymentId: `pi_${suffix}_${payment.id}` });
    expect(await prisma.paymentWebhookEvent.count({ where: { eventId } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { workspaceId: ctxA.workspace.id, action: "finance.invoice_paid", targetId: invoiceId } })).toBe(1);
  });
  it("rejects bad signatures, stale timestamps and unknown tokens", async () => {
    const payment = await linkFor(await sentInvoice());
    expect((await webhook(tokenA, payment, { secret: "whsec_wrongwrongwrong" })).status).toBe(400);
    expect((await webhook(tokenA, payment, { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(400);
    expect((await webhook("not-a-real-token-0000000000", payment)).status).toBe(404);
    expect((await prisma.invoice.findFirstOrThrow({ where: { id: payment.invoiceId } })).status).toBe("SENT");
  });
  it("cannot settle another workspace's invoice with a different workspace's token", async () => {
    const payment = await linkFor(await sentInvoice());
    const response = await webhook(tokenB, payment, { secret: "whsec_OtherWorkspaceSecret1" });
    expect(response.status).toBe(200);
    expect((await prisma.invoice.findFirstOrThrow({ where: { id: payment.invoiceId } })).status).toBe("SENT");
    expect((await prisma.invoicePayment.findFirstOrThrow({ where: { id: payment.id } })).status).toBe("CREATED");
    expect(await ledger(payment.invoiceId)).toBe(0);
    expect(await prisma.paymentWebhookEvent.findFirst({ where: { workspaceId: ctxB.workspace.id }, orderBy: { receivedAt: "desc" } })).toMatchObject({ status: "IGNORED_UNKNOWN_PAYMENT" });
  });
  it("sends a mismatched amount to review without paying the invoice", async () => {
    const payment = await linkFor(await sentInvoice());
    expect((await webhook(tokenA, payment, { amount: 500 })).status).toBe(200);
    expect(await prisma.invoicePayment.findFirstOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "NEEDS_REVIEW" });
    expect((await prisma.invoice.findFirstOrThrow({ where: { id: payment.invoiceId } })).status).toBe("SENT");
    expect(await ledger(payment.invoiceId)).toBe(0);
  });
  it("sends a payment to review when the finance month is signed off", async () => {
    const payment = await linkFor(await sentInvoice());
    const month = new Date().toISOString().slice(0, 7);
    await prisma.financeMonth.upsert({ where: { workspaceId_month: { workspaceId: ctxA.workspace.id, month } }, create: { workspaceId: ctxA.workspace.id, month, signedOffAt: new Date() }, update: { signedOffAt: new Date() } });
    try {
      expect((await webhook(tokenA, payment)).status).toBe(200);
      expect(await prisma.invoicePayment.findFirstOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "NEEDS_REVIEW" });
      expect((await prisma.invoice.findFirstOrThrow({ where: { id: payment.invoiceId } })).status).toBe("SENT");
      expect(await ledger(payment.invoiceId)).toBe(0);
    } finally {
      await prisma.financeMonth.updateMany({ where: { workspaceId: ctxA.workspace.id, month }, data: { signedOffAt: null } });
    }
  });
  it("never pays a draft or void invoice", async () => {
    const created = await finance.createInvoice(ctxA, values);
    if (!created.ok) throw new Error(created.error);
    const draft = created.data!.id;
    const draftPayment = await prisma.invoicePayment.create({ data: { workspaceId: ctxA.workspace.id, invoiceId: draft, provider: "STRIPE", amountMinor: 10000, currency: "INR", externalLinkId: `cs_draft_${suffix}` } });
    expect((await webhook(tokenA, draftPayment)).status).toBe(200);
    expect((await prisma.invoice.findFirstOrThrow({ where: { id: draft } })).status).toBe("DRAFT");
    expect((await prisma.invoicePayment.findFirstOrThrow({ where: { id: draftPayment.id } })).status).toBe("NEEDS_REVIEW");
    const voided = await linkFor(await sentInvoice());
    await finance.voidInvoice(ctxA, voided.invoiceId);
    expect((await webhook(tokenA, voided)).status).toBe(200);
    expect((await prisma.invoice.findFirstOrThrow({ where: { id: voided.invoiceId } })).status).toBe("VOID");
    expect(await ledger(voided.invoiceId)).toBe(0);
  });
  it("records refunds as absolute amounts, idempotently", async () => {
    const payment = await linkFor(await sentInvoice());
    await webhook(tokenA, payment);
    const refund = (amountRefunded: number) => {
      const body = JSON.stringify({ id: `evt_${suffix}_ref${amountRefunded}`, type: "charge.refunded", data: { object: { payment_intent: `pi_${suffix}_${payment.id}`, amount: 10000, amount_refunded: amountRefunded, currency: "inr" } } });
      const t = String(Math.floor(Date.now() / 1000));
      return receivePaymentWebhook(new Request("http://localhost/x", { method: "POST", body, headers: { "stripe-signature": `t=${t},v1=${createHmac("sha256", WHSEC).update(`${t}.${body}`).digest("hex")}` } }), "stripe", tokenA);
    };
    await refund(2500);
    expect(await prisma.invoicePayment.findFirstOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedMinor: 2500 });
    await refund(10000);
    expect(await prisma.invoicePayment.findFirstOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "REFUNDED", refundedMinor: 10000 });
  });
});

describe.sequential("invoice email outbox", () => {
  it("keeps the hosted pay link out of the outbox row and puts it in the sent email", async () => {
    const created = await finance.createInvoice(ctxA, values);
    if (!created.ok) throw new Error(created.error);
    const invoiceId = created.data!.id;
    await finance.sendInvoice(ctxA, invoiceId, { email: false });
    const payment = await linkFor(invoiceId);
    expect(payment.url).toContain("https://checkout.stripe.com");
    expect((await finance.sendInvoice(ctxA, invoiceId, { email: true })).ok).toBe(true);
    const row = await prisma.outboxMessage.findFirstOrThrow({ where: { kind: "invoice.email", payload: { path: ["invoiceId"], equals: invoiceId } } });
    expect(JSON.stringify(row.payload)).not.toContain("https://");
    expect(JSON.stringify(row.payload)).not.toContain("checkout.stripe.com");
    expect(row.payload).toMatchObject({ workspaceId: ctxA.workspace.id, invoiceId, to: `client${domain}` });
    sent.length = 0;
    expect((await deliverOutboxBatch(20, { ids: [row.id] })).sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: `client${domain}`, workspaceId: ctxA.workspace.id });
    expect(sent[0]!.html).toContain(payment.url!);
    expect(sent[0]!.text).toContain(`Pay online: ${payment.url}`);
    const after = await prisma.outboxMessage.findFirstOrThrow({ where: { id: row.id } });
    expect(JSON.stringify(after.payload)).not.toContain("checkout.stripe.com");
  });
});

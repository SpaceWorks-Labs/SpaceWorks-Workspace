import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@/lib/permissions";

const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.id ? { user: { id: session.id } } : null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));

import { prisma } from "@/lib/db";
import { findDownloadableFile } from "@/lib/files";
import { getWorkspaceForAction } from "@/lib/permissions";
import { dateOnly } from "@/lib/finance/dates";
import { parseLedgerFilters } from "@/lib/finance/filters";
import { getFinanceSummary, listInvoices, listLedger } from "@/lib/finance/queries";
import { invoiceSchema } from "@/lib/finance/schemas";
import * as service from "@/lib/finance/service";
import { createCategoryAction, createInvoiceAction, createLedgerEntryAction, commitLedgerImportAction, markInvoicePaidAction, previewLedgerImportAction, updateLedgerEntryAction } from "@/app/actions/finance";
import { GET as exportLedger } from "@/app/w/[workspaceSlug]/finance/ledger/export/route";
import { notifyOverdueInvoices } from "@/lib/scheduled/finance";
import { deleteObjects } from "@/lib/storage";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@finance-${suffix}.test`;
const slugA = `finance-a-${suffix}`;
const slugB = `finance-b-${suffix}`;
let ctx: WorkspaceContext;
let foreign: WorkspaceContext;
const users: Record<string, string> = {};
let expenseCategory: string;

function entryForm(amount = "10.50", categoryId = expenseCategory) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ kind: "EXPENSE", amount, occurredOn: "2026-10-19", description: "Solder for build night", categoryId })) form.set(key, value);
  return form;
}
const invoiceValues = (unitPrice = "100") => invoiceSchema.parse({ clientName: "Maker partner", clientEmail: `client${domain}`, issuedOn: "2026-10-01", dueOn: "2026-10-18", items: [{ description: "Workshop", quantity: 1.5, unitPrice, taxBps: 1800 }] });
async function newInvoice() {
  const result = await service.createInvoice(ctx, invoiceValues());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.data!.id;
}

beforeAll(async () => {
  for (const role of ["owner", "admin", "member", "guest", "outsider"]) users[role] = (await createUser(`${role}${domain}`)).id;
  const workspace = await createWorkspace(slugA, users.owner!);
  await createWorkspace(slugB, users.outsider!);
  await addMember(workspace.id, users.admin!, "ADMIN");
  await addMember(workspace.id, users.member!, "MEMBER");
  await addMember(workspace.id, users.guest!, "GUEST");
  session.id = users.owner!;
  ctx = (await getWorkspaceForAction(slugA))!;
  session.id = users.outsider!;
  foreign = (await getWorkspaceForAction(slugB))!;
  session.id = users.owner!;
  expenseCategory = (await prisma.financeCategory.create({ data: { workspaceId: workspace.id, name: "Tools", kind: "EXPENSE" } })).id;
}, 60_000);
afterAll(async () => {
  const files = await prisma.fileObject.findMany({ where: { workspace: { slug: { in: [slugA, slugB] } } }, select: { storageKey: true } });
  await deleteObjects(files.map((f) => f.storageKey));
  await prisma.outboxMessage.deleteMany({ where: { kind: { in: ["email", "invoice.email"] }, payload: { path: ["to"], equals: `client${domain}` } } });
  await cleanup([slugA, slugB], domain);
  await prisma.$disconnect();
});

describe.sequential("finance access and tenancy", () => {
  it.each([
    ["owner", false, 200], ["admin", false, 200], ["member", false, 404], ["guest", false, 404],
    ["member", true, 200], ["guest", true, 404], ["outsider", true, 404], ["", true, 404],
  ])("export: %s, visible=%s returns %s", async (role, visible, status) => {
    await prisma.workspace.update({ where: { id: ctx.workspace.id }, data: { financeVisibleToMembers: visible } });
    session.id = users[role] ?? "";
    const response = await exportLedger(new Request(`http://localhost/w/${slugA}/finance/ledger/export`), { params: Promise.resolve({ workspaceSlug: slugA }) });
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it.each(["member", "guest", "outsider"])("denies %s finance mutations even with public member visibility", async (role) => {
    session.id = users[role]!;
    expect(await createCategoryAction(slugA, { name: "Denied", kind: "INCOME" })).toMatchObject({ ok: false });
    expect(await createInvoiceAction(slugA, invoiceValues())).toMatchObject({ ok: false });
    expect(await createLedgerEntryAction(slugA, entryForm())).toMatchObject({ ok: false });
    expect(await commitLedgerImportAction(slugA, "date,kind,amount,description\n2026-10-19,income,1,Denied")).toMatchObject({ ok: false });
  });
  it("rejects cross-workspace category, budget, entry and invoice ids", async () => {
    session.id = users.owner!;
    const foreignCategory = await prisma.financeCategory.create({ data: { workspaceId: foreign.workspace.id, name: "Foreign", kind: "EXPENSE" } });
    expect(await createLedgerEntryAction(slugA, entryForm("10", foreignCategory.id))).toMatchObject({ ok: false });
    const budget = await prisma.budget.create({ data: { workspaceId: foreign.workspace.id, name: "Foreign budget", periodStart: dateOnly("2026-01-01"), periodEnd: dateOnly("2026-12-31"), amountMinor: 1000 } });
    const form = entryForm(); form.set("budgetId", budget.id);
    expect(await createLedgerEntryAction(slugA, form)).toMatchObject({ ok: false });
    const own = await createLedgerEntryAction(slugA, entryForm());
    expect(own.ok).toBe(true);
    if (!own.ok) return;
    session.id = users.outsider!;
    expect(await updateLedgerEntryAction(slugB, own.data!.id, entryForm())).toMatchObject({ ok: false });
    const invoiceId = await newInvoice();
    expect(await markInvoicePaidAction(slugB, { invoiceId })).toMatchObject({ ok: false });
    const ledger = await listLedger(foreign.workspace, parseLedgerFilters({}));
    expect(ledger.rows).toHaveLength(0);
  });
  it("denies suspended and disabled accounts", async () => {
    session.id = users.admin!;
    await prisma.membership.update({ where: { userId_workspaceId: { userId: users.admin!, workspaceId: ctx.workspace.id } }, data: { status: "SUSPENDED" } });
    expect(await createCategoryAction(slugA, { name: "Denied", kind: "INCOME" })).toMatchObject({ ok: false });
    await prisma.membership.update({ where: { userId_workspaceId: { userId: users.admin!, workspaceId: ctx.workspace.id } }, data: { status: "ACTIVE" } });
    await prisma.user.update({ where: { id: users.admin! }, data: { disabledAt: new Date() } });
    expect(await createCategoryAction(slugA, { name: "Denied", kind: "INCOME" })).toMatchObject({ ok: false });
    await prisma.user.update({ where: { id: users.admin! }, data: { disabledAt: null } });
  });
  it("keeps uploaded receipts behind the finance visibility gate", async () => {
    session.id = users.owner!;
    const form = entryForm();
    form.set("receipt", new File(["%PDF-1.4\nreceipt"], "receipt.pdf", { type: "application/pdf" }));
    const result = await createLedgerEntryAction(slugA, form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { id: result.data!.id, workspaceId: ctx.workspace.id } });
    const fileId = entry.receiptFileId!;
    await prisma.workspace.update({ where: { id: ctx.workspace.id }, data: { financeVisibleToMembers: false } });
    expect(await findDownloadableFile(fileId, users.member!)).toBeNull();
    expect(await findDownloadableFile(fileId, users.guest!)).toBeNull();
    expect(await findDownloadableFile(fileId, users.owner!)).not.toBeNull();
    await prisma.workspace.update({ where: { id: ctx.workspace.id }, data: { financeVisibleToMembers: true } });
    expect(await findDownloadableFile(fileId, users.member!)).not.toBeNull();
    expect(await findDownloadableFile(fileId, users.outsider!)).toBeNull();
  });
  it("validates and revalidates CSV before creating entries", async () => {
    session.id = users.admin!;
    const csv = "date,kind,amount,currency,category,description\n2026-10-19,expense,12.50,INR,Tools,Imported parts";
    expect(await previewLedgerImportAction(slugA, csv)).toMatchObject({ ok: true, data: { problems: [], rows: [{ amountMinor: 1250 }] } });
    expect(await commitLedgerImportAction(slugA, csv.replace("12.50", "-12.50"))).toMatchObject({ ok: false });
    expect(await commitLedgerImportAction(slugA, csv)).toMatchObject({ ok: true, data: { count: 1 } });
    expect(await createLedgerEntryAction(slugA, entryForm("-5"))).toMatchObject({ ok: false });
    expect(await createLedgerEntryAction(slugA, entryForm("21474836.48"))).toMatchObject({ ok: false });
  });
  it("does not leave unlinked receipts when edits race", async () => {
    session.id = users.owner!;
    const entry = await createLedgerEntryAction(slugA, entryForm());
    expect(entry.ok).toBe(true);
    if (!entry.ok) return;
    const results = await Promise.all([1, 2].map((n) => {
      const form = entryForm();
      form.set("receipt", new File(["%PDF-1.4\nreceipt"], `concurrent-receipt-${n}.pdf`, { type: "application/pdf" }));
      return updateLedgerEntryAction(slugA, entry.data!.id, form);
    }));
    expect(results.some((result) => result.ok)).toBe(true);
    const current = await prisma.ledgerEntry.findFirstOrThrow({ where: { id: entry.data!.id, workspaceId: ctx.workspace.id } });
    const files = await prisma.fileObject.findMany({ where: { workspaceId: ctx.workspace.id, filename: { startsWith: "concurrent-receipt-" }, deletedAt: null } });
    expect(files.map((f) => f.id)).toEqual([current.receiptFileId]);
  });
});

describe.sequential("invoices and totals", () => {
  it("posts one income entry for repeated and concurrent payments", async () => {
    const id = await newInvoice();
    expect(await service.markInvoicePaid(ctx, id)).toMatchObject({ ok: false });
    expect(await service.sendInvoice(ctx, id, { email: false })).toMatchObject({ ok: true });
    const results = await Promise.all([service.markInvoicePaid(ctx, id), service.markInvoicePaid(ctx, id), service.markInvoicePaid(ctx, id)]);
    expect(results.every((r) => r.ok)).toBe(true);
    const entries = await prisma.ledgerEntry.findMany({ where: { workspaceId: ctx.workspace.id, sourceType: "invoice", sourceId: id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "INCOME", amountMinor: 17700, currency: "INR" });
    expect(await service.updateInvoice(ctx, id, invoiceValues("1"))).toMatchObject({ ok: false });
    expect(await service.setLedgerEntryVoided(ctx, entries[0]!.id, true)).toMatchObject({ ok: false });
    expect(await service.voidInvoice(ctx, id)).toMatchObject({ ok: true });
    expect((await prisma.ledgerEntry.findFirstOrThrow({ where: { workspaceId: ctx.workspace.id, sourceId: id } })).voidedAt).not.toBeNull();
    expect(await service.markInvoicePaid(ctx, id)).toMatchObject({ ok: false });
  });
  it("serialises an edit racing a payment without changing the posted total", async () => {
    const id = await newInvoice();
    await service.sendInvoice(ctx, id, { email: false });
    await Promise.all([service.updateInvoice(ctx, id, invoiceValues("200")), service.markInvoicePaid(ctx, id)]);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { id, workspaceId: ctx.workspace.id } });
    const entry = await prisma.ledgerEntry.findFirstOrThrow({ where: { workspaceId: ctx.workspace.id, sourceType: "invoice", sourceId: id } });
    expect(entry.amountMinor).toBe(invoice.totalMinor);
  });
  it("queues a complete invoice email without copying finance into global search", async () => {
    const id = await newInvoice();
    const before = await prisma.outboxMessage.count({ where: { kind: "invoice.email" } });
    expect(await service.sendInvoice(ctx, id, { email: true })).toMatchObject({ ok: true, data: { emailed: true } });
    expect(await prisma.outboxMessage.count({ where: { kind: "invoice.email" } })).toBe(before + 1);
    expect(await prisma.searchDocument.findFirst({ where: { workspaceId: ctx.workspace.id, entityType: "invoice", entityId: id } })).toBeNull();
  });
  it("counts only the workspace currency and ignores voided money", async () => {
    const workspace = foreign.workspace;
    await prisma.ledgerEntry.createMany({ data: [
      { workspaceId: workspace.id, kind: "INCOME", amountMinor: 1000, currency: "INR", description: "Opening", occurredOn: dateOnly("2026-10-01") },
      { workspaceId: workspace.id, kind: "EXPENSE", amountMinor: 250, currency: "INR", description: "Parts", occurredOn: dateOnly("2026-10-02") },
      { workspaceId: workspace.id, kind: "EXPENSE", amountMinor: 900, currency: "INR", description: "Void", occurredOn: dateOnly("2026-10-03"), voidedAt: new Date() },
      { workspaceId: workspace.id, kind: "INCOME", amountMinor: 800, currency: "USD", description: "USD", occurredOn: dateOnly("2026-10-04") },
    ] });
    const ledger = await listLedger(workspace, parseLedgerFilters({}));
    expect(ledger.totals).toMatchObject({ incomeMinor: 1000, expenseMinor: 250, netMinor: 750 });
    expect(ledger.rows.find((r) => r.description === "Parts")?.balanceMinor).toBe(750);
    expect(ledger.rows.find((r) => r.description === "USD")?.balanceMinor).toBeNull();
    expect(await getFinanceSummary(workspace, new Date("2026-10-19"))).toMatchObject({ balanceMinor: 750, thisMonth: { incomeMinor: 1000, expenseMinor: 250 } });
  });
  it("sends one overdue notice per due date across concurrent scheduler runs", async () => {
    const id = await newInvoice();
    await service.sendInvoice(ctx, id, { email: false });
    const now = new Date("2026-10-19T00:00:00Z");
    await Promise.all([notifyOverdueInvoices(now), notifyOverdueInvoices(now)]);
    expect(await prisma.auditEvent.count({ where: { workspaceId: ctx.workspace.id, targetId: id, action: "finance.invoice_overdue" } })).toBe(1);
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: ctx.workspace.id, dedupeKey: `invoice.overdue:${id}:2026-10-18` } })).toBe(1);
    await notifyOverdueInvoices(now);
    expect(await prisma.auditEvent.count({ where: { workspaceId: ctx.workspace.id, targetId: id, action: "finance.invoice_overdue" } })).toBe(1);
  });
  it("compares budgets only with matching expenses within the budget period", async () => {
    const budget = await prisma.budget.create({ data: { workspaceId: ctx.workspace.id, name: "Build night budget", periodStart: dateOnly("2026-10-01"), periodEnd: dateOnly("2026-10-31"), amountMinor: 10000, currency: "INR" } });
    const common = { workspaceId: ctx.workspace.id, budgetId: budget.id, currency: "INR", kind: "EXPENSE" as const, description: "Budget check", occurredOn: dateOnly("2026-10-19") };
    await prisma.ledgerEntry.createMany({ data: [
      { ...common, amountMinor: 2500 },
      { ...common, amountMinor: 1000, kind: "INCOME" },
      { ...common, amountMinor: 1000, voidedAt: new Date() },
      { ...common, amountMinor: 1000, occurredOn: dateOnly("2026-09-30") },
      { ...common, amountMinor: 1000, currency: "USD" },
    ] });
    const summary = await getFinanceSummary(ctx.workspace, new Date("2026-10-19"));
    expect(summary.budgets.find((b) => b.id === budget.id)).toMatchObject({ spentMinor: 2500, amountMinor: 10000 });
    expect((await getFinanceSummary(foreign.workspace, new Date("2026-10-19"))).budgets.some((b) => b.id === budget.id)).toBe(false);
  });
  it("paginates invoices without dropping older records or mixing tenants", async () => {
    await prisma.invoice.createMany({ data: Array.from({ length: 51 }, (_, n) => ({ workspaceId: foreign.workspace.id, number: `PAGE-${n}`, clientName: "Pagination partner", issuedOn: dateOnly("2026-10-19"), currency: "INR", items: [], totalMinor: 0 })) });
    const first = await listInvoices(foreign.workspace.id, "DRAFT", 1);
    const second = await listInvoices(foreign.workspace.id, "DRAFT", 2);
    expect(first.pageCount).toBe(2);
    expect(first.invoices).toHaveLength(50);
    expect(second.invoices).toHaveLength(1);
    expect(new Set([...first.invoices, ...second.invoices].map((i) => i.id)).size).toBe(51);
    expect(second.invoices[0]!.number).toMatch(/^PAGE-/);
  });
});

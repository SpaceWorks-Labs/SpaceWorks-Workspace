import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { loadStatements } from "@/lib/finance/statements/load";
import { statementCsv } from "@/lib/finance/statements/export";
import { fcraReceiptsCsv } from "@/lib/finance/fcra";
import { saveRecord, operate } from "@/lib/funding/service";
import { recordDonationInLedger, recordDonationsInLedger } from "@/lib/funding/service/ledger-link";
import { createAssetFromInKind } from "@/lib/funding/service/ledger-link-inkind";
import { createWorkspaceWithDefaults } from "@/lib/workspaces";
import { createUser, addMember, cleanup, uniqueSuffix } from "../helpers/fixtures";

// A generous timeout keeps workspace setup stable on a busy machine.
const createWorkspace = (slug: string, ownerId: string) => prisma.$transaction((tx) => createWorkspaceWithDefaults(tx, { name: `Workspace ${slug}`, slug, ownerId }), { timeout: 60000 });

const suffix = uniqueSuffix(), emailSuffix = `@stmt-${suffix}.test`, slugs = [`stmt-${suffix}`, `stmt-other-${suffix}`];
type A = Parameters<typeof recordDonationInLedger>[0];
let actor: A, other: A, member: A;
let contactId = "", bankId = "", catId = "", plainFund = "", fcraFund = "";
const gift = (over: Record<string, unknown> = {}, details: Record<string, unknown> = {}) => ({
  kind: "DONATION", title: "Gift", status: "RECEIVED", currency: "INR", contactId, amountMinor: 250000, dateOn: "2026-09-05", details: { mode: "BANK", ...details }, ...over,
});
const make = async (over = {}, details = {}) => (await saveRecord(actor as never, gift(over, details))).id;
const entry = (over: Record<string, unknown>) => prisma.ledgerEntry.create({ data: { workspaceId: actor.workspace.id, kind: "INCOME", amountMinor: 1000, currency: "INR", description: "x", occurredOn: new Date("2026-06-01"), ...over } as never });

beforeAll(async () => {
  const owner = await createUser(`o${emailSuffix}`), stranger = await createUser(`x${emailSuffix}`), ordinary = await createUser(`m${emailSuffix}`);
  const ws = await createWorkspace(slugs[0]!, owner.id), ws2 = await createWorkspace(slugs[1]!, stranger.id);
  actor = { user: owner, workspace: ws, membership: { role: "OWNER" } } as A;
  other = { user: stranger, workspace: ws2, membership: { role: "OWNER" } } as A;
  member = { user: ordinary, workspace: ws, membership: await addMember(ws.id, ordinary.id) } as A;
  contactId = (await prisma.contact.create({ data: { workspaceId: ws.id, displayName: "Asha Donor" } })).id;
  bankId = (await prisma.financeAccount.create({ data: { workspaceId: ws.id, name: "Bank", openingMinor: 100000, openingOn: new Date("2025-04-01") } })).id;
  catId = (await prisma.financeCategory.create({ data: { workspaceId: ws.id, name: "Gifts", kind: "INCOME" } })).id;
  plainFund = (await prisma.financeFund.create({ data: { workspaceId: ws.id, name: "Core" } })).id;
  fcraFund = (await prisma.financeFund.create({ data: { workspaceId: ws.id, name: "Foreign", restricted: true, fcra: true } })).id;
});
afterAll(() => cleanup(slugs, emailSuffix), 60000);

describe("statements", () => {
  it("reconcile with the ledger and leave out void, payroll and other tenants", async () => {
    const rent = await prisma.financeCategory.create({ data: { workspaceId: actor.workspace.id, name: "Rent", kind: "EXPENSE" } });
    await entry({ amountMinor: 500000, accountId: bankId, categoryId: catId, occurredOn: new Date("2026-05-01"), fundId: plainFund });
    await entry({ kind: "EXPENSE", amountMinor: 120000, accountId: bankId, categoryId: rent.id, occurredOn: new Date("2026-07-01"), fundId: plainFund });
    await entry({ kind: "EXPENSE", amountMinor: 999999, privatePayroll: true, accountId: bankId, occurredOn: new Date("2026-07-02") });
    await entry({ amountMinor: 777777, voidedAt: new Date(), accountId: bankId });
    await entry({ amountMinor: 40000, accountId: bankId, occurredOn: new Date("2026-03-01") });
    await prisma.ledgerEntry.create({ data: { workspaceId: other.workspace.id, kind: "INCOME", amountMinor: 888888, currency: "INR", description: "x", occurredOn: new Date("2026-06-01") } });
    const s = await loadStatements(actor as never, { year: 2026 });
    expect(s.range.label).toBe("2026-27");
    expect(s.rp.receiptsMinor).toBe(500000);
    expect(s.rp.paymentsMinor).toBe(120000);
    const bank = s.rp.cash.find((c) => c.accountId === bankId)!;
    expect(bank.openingMinor).toBe(140000);
    expect(s.rp.closingMinor).toBe(140000 + 500000 - 120000);
    expect(s.rp.openingMinor + s.rp.receiptsMinor - s.rp.paymentsMinor + s.rp.transfersMinor).toBe(s.rp.closingMinor);
    expect(s.ie.surplusMinor).toBe(380000);
    expect(s.funds.total.closingMinor).toBe(420000);
    expect(statementCsv(s, "receipts-payments")).toContain("auditor's accounts are authoritative");
  });
  it("follows the workspace financial year start month", async () => {
    await prisma.workspace.update({ where: { id: actor.workspace.id }, data: { fiscalYearStartMonth: 1 } });
    const s = await loadStatements(actor as never, { year: 2026 });
    expect(s.range).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
    await prisma.workspace.update({ where: { id: actor.workspace.id }, data: { fiscalYearStartMonth: 4 } });
  });
  it("denies members who cannot see finance and other tenants", async () => {
    await expect(loadStatements(member as never)).rejects.toThrow();
    await expect(loadStatements({ ...other, workspace: actor.workspace } as never)).rejects.toThrow();
  });
});

describe("donation to ledger", () => {
  it("posts once, links the record and stays idempotent under retries and races", async () => {
    const id = await make();
    const picks = { id, accountId: bankId, categoryId: catId, fundId: plainFund };
    const results = await Promise.all(Array.from({ length: 5 }, () => recordDonationInLedger(actor, picks).catch((e: Error) => ({ status: "error", error: e.message }))));
    expect(results.filter((r) => r.status === "posted")).toHaveLength(1);
    const entries = await prisma.ledgerEntry.findMany({ where: { sourceType: "FUNDING_DONATION", sourceId: id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "INCOME", amountMinor: 250000, counterparty: "Asha Donor", fundId: plainFund, accountId: bankId, categoryId: catId });
    expect((await prisma.fundingRecord.findUniqueOrThrow({ where: { id } })).ledgerEntryId).toBe(entries[0]!.id);
    expect(await recordDonationInLedger(actor, picks)).toEqual({ status: "already", entryId: entries[0]!.id });
  });
  it("warns about a possible duplicate until confirmed", async () => {
    await entry({ amountMinor: 123400, occurredOn: new Date("2026-10-04"), description: "Bank credit" });
    const id = await make({ amountMinor: 123400, dateOn: "2026-10-06" });
    const first = await recordDonationInLedger(actor, { id });
    expect(first.status).toBe("duplicate");
    expect(await prisma.ledgerEntry.count({ where: { sourceId: id } })).toBe(0);
    expect((await recordDonationInLedger(actor, { id, confirmDuplicate: true })).status).toBe("posted");
    const far = await make({ amountMinor: 123400, dateOn: "2026-10-12" });
    expect((await recordDonationInLedger(actor, { id: far })).status).toBe("posted");
  });
  it("voids the entry when the donation is voided and keeps statements honest", async () => {
    const id = await make({ amountMinor: 3300, dateOn: "2026-11-01" });
    const posted = await recordDonationInLedger(actor, { id });
    if (posted.status !== "posted") throw new Error("expected posted");
    await operate(actor as never, { op: "void", id });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: posted.entryId } })).voidedAt).not.toBeNull();
    await expect(recordDonationInLedger(actor, { id })).rejects.toThrow();
  });
  it("records a selection in bulk and reports each outcome", async () => {
    const a = await make({ amountMinor: 1111, dateOn: "2026-08-01" }), b = await make({ amountMinor: 2222, dateOn: "2026-08-02" }), c = await make({ amountMinor: 3333, dateOn: "2026-08-03" }, { mode: "IN_KIND", inKindItem: "Chair" });
    const out = await recordDonationsInLedger(actor, { ids: [a, b, c, "missing"] });
    expect(out.map((o) => o.result.status)).toEqual(["posted", "posted", "error", "error"]);
  });
  it("rejects other tenants and members", async () => {
    const id = await make({ amountMinor: 4444, dateOn: "2026-08-09" });
    await expect(recordDonationInLedger(other, { id })).rejects.toThrow();
    await expect(recordDonationInLedger(member, { id })).rejects.toThrow();
    expect(await prisma.ledgerEntry.count({ where: { sourceId: id } })).toBe(0);
  });
});

describe("FCRA and in-kind", () => {
  it("only lets foreign-source gifts post to an FCRA fund", async () => {
    const id = await make({ amountMinor: 9000, dateOn: "2026-08-20" }, { foreignSource: true });
    await expect(recordDonationInLedger(actor, { id })).rejects.toThrow(/FCRA/);
    await expect(recordDonationInLedger(actor, { id, fundId: plainFund })).rejects.toThrow(/FCRA/);
    expect((await recordDonationInLedger(actor, { id, fundId: fcraFund })).status).toBe("posted");
    const { csv, count } = await fcraReceiptsCsv(actor as never, 2026, 3);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(csv).toContain("Asha Donor");
    expect(csv).toContain("90.00");
    expect(csv).toContain("Foreign");
    await expect(fcraReceiptsCsv(member as never, 2026, 3)).rejects.toThrow();
  });
  it("creates one asset record for an in-kind gift and never a ledger entry", async () => {
    const id = await make({ amountMinor: 80000, dateOn: "2026-09-10", title: "Laser" }, { mode: "IN_KIND", inKindItem: "Laser cutter" });
    await expect(recordDonationInLedger(actor, { id })).rejects.toThrow(/asset/);
    const [one, two] = await Promise.all([createAssetFromInKind(actor as never, { id, note: "Working", estimatedMinor: 75000 }), createAssetFromInKind(actor as never, { id })]);
    expect(one.assetId).toBe(two.assetId);
    expect([one.created, two.created].filter(Boolean)).toHaveLength(1);
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: one.assetId } });
    expect(asset).toMatchObject({ name: "Laser cutter", purchasePriceMinor: expect.any(Number), currency: "INR" });
    expect(asset.notes).toContain("Estimated value");
    expect(await prisma.ledgerEntry.count({ where: { sourceId: id } })).toBe(0);
    await expect(createAssetFromInKind(actor as never, { id: await make() })).rejects.toThrow();
    await expect(createAssetFromInKind(other as never, { id })).rejects.toThrow();
  });
});

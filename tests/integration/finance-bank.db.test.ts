import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getWorkspaceForAction, type WorkspaceContext } from "@/lib/permissions";
import { addAccount } from "@/lib/finance/tools/close";
import { addEntry } from "@/lib/finance/tools/service";
import { commitBankImport, createEntryFromBankLine, loadBankView, matchBankLine, previewBankImport, setBankLineIgnored, unmatchBankLine } from "@/lib/finance/bank";
import { FinanceError } from "@/lib/finance/tools/access";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";


const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.id ? { user: { id: session.id } } : null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));

const suffix = uniqueSuffix();
const domain = `@bank-${suffix}.test`;
const slugs = [`bk-${suffix}`, `bk-other-${suffix}`];
let owner: WorkspaceContext, member: WorkspaceContext, foreign: WorkspaceContext;
let accountId: string, foreignAccountId: string;

const mapping = { date: 0, description: 1, amount: 2, debit: null, credit: null, balance: null, reference: 3, dateOrder: "dmy" as const, hasHeader: true };
const csv = (rows: string[]) => `Date,Narration,Amount,Ref\n${rows.join("\n")}\n`;
const importFile = (text: string, filename = "s.csv", account = accountId, actor = owner) => commitBankImport(actor, { accountId: account, format: "CSV", filename, text, mapping });
const lineBy = (description: string) => prisma.financeBankLine.findFirstOrThrow({ where: { accountId, description } });
const entry = (extra: Record<string, unknown> = {}) => addEntry(owner, { kind: "EXPENSE", amountMinor: 5000, currency: "INR", occurredOn: "2026-06-10", description: "Paper", accountId, ...extra });

async function as(slug: string, id: string) {
  session.id = id;
  return (await getWorkspaceForAction(slug))!;
}

beforeAll(async () => {
  const [o, m, g] = await Promise.all(["owner", "member", "guest"].map((n) => createUser(`${n}${domain}`, n)));
  const w = await createWorkspace(slugs[0]!, o!.id);
  await createWorkspace(slugs[1]!, o!.id);
  await addMember(w.id, m!.id);
  await addMember(w.id, g!.id, "GUEST");
  owner = await as(slugs[0]!, o!.id);
  member = await as(slugs[0]!, m!.id);
  foreign = await as(slugs[1]!, o!.id);
  accountId = await addAccount(owner, { name: "Main bank", currency: "INR", openingMinor: 0, openingOn: "2026-01-01" });
  foreignAccountId = await addAccount(foreign, { name: "Other bank", currency: "INR", openingMinor: 0, openingOn: "2026-01-01" });
}, 60000);
afterAll(async () => {
  await cleanup(slugs, domain);
  await prisma.$disconnect();
}, 60000);

describe.sequential("bank import", () => {
  it("previews without writing, then imports once", async () => {
    const text = csv(["10/06/2026,Paper supplier,\"-50.00\",R1", "11/06/2026,Donation,\"1,000.00\",R2"]);
    const preview = await previewBankImport(owner, { accountId, format: "CSV", filename: "s.csv", text, mapping });
    expect(preview).toMatchObject({ total: 2, newCount: 2, duplicateCount: 0, fileAlreadyImported: false });
    expect(await prisma.financeBankLine.count({ where: { accountId } })).toBe(0);
    expect(await importFile(text)).toMatchObject({ imported: 2, skipped: 0 });
    await expect(importFile(text)).rejects.toThrow(/already imported/);
  });
  it("skips lines already imported from an overlapping statement", async () => {
    const text = csv(["10/06/2026,Paper supplier,\"-50.00\",R1", "12/06/2026,Bank fee,-5.00,R3"]);
    expect(await previewBankImport(owner, { accountId, format: "CSV", filename: "o.csv", text, mapping })).toMatchObject({ newCount: 1, duplicateCount: 1 });
    expect(await importFile(text, "o.csv")).toMatchObject({ imported: 1, skipped: 1 });
    expect(await prisma.financeBankLine.count({ where: { accountId } })).toBe(3);
    const stored = await lineBy("Bank fee");
    expect(stored).toMatchObject({ amountMinor: -500, currency: "INR", status: "UNMATCHED" });
  });
  it("refuses an import with row problems", async () => {
    await expect(importFile(csv(["not a date,x,1,"]), "bad.csv")).rejects.toBeInstanceOf(FinanceError);
  });
  it("is limited to admins and to this workspace's accounts", async () => {
    await expect(importFile(csv(["10/06/2026,x,1,"]), "m.csv", accountId, member)).rejects.toThrow(/access/);
    await expect(importFile(csv(["10/06/2026,x,1,"]), "f.csv", foreignAccountId, owner)).rejects.toThrow(/account in this workspace/);
  });
});

describe.sequential("matching", () => {
  it("suggests, matches, marks the entry reconciled and keeps it one-to-one", async () => {
    const e = await entry({ description: "Paper supplier" });
    const view = await loadBankView(owner, { accountId });
    const suggested = view.lines.find((l) => l.description === "Paper supplier")!;
    expect(suggested.suggestion).toMatchObject({ entryId: e });
    await matchBankLine(owner, { lineId: suggested.id, entryId: e });
    expect((await prisma.ledgerEntry.findFirstOrThrow({ where: { id: e } })).reconciledAt).not.toBeNull();
    expect(await prisma.financeBankLine.findFirstOrThrow({ where: { id: suggested.id } })).toMatchObject({ status: "MATCHED", ledgerEntryId: e });
    const twin = await prisma.financeBankLine.create({ data: { workspaceId: owner.workspace.id, statementId: (await prisma.financeBankLine.findFirstOrThrow({ where: { id: suggested.id } })).statementId, accountId, postedOn: new Date("2026-06-10T00:00:00Z"), description: "Twin", amountMinor: -5000, currency: "INR", lineHash: `twin-${suffix}` } });
    await expect(matchBankLine(owner, { lineId: twin.id, entryId: e })).rejects.toThrow(/already matched|unavailable/);
    await unmatchBankLine(owner, { lineId: suggested.id });
    expect((await prisma.ledgerEntry.findFirstOrThrow({ where: { id: e } })).reconciledAt).toBeNull();
  });
  it("rejects a different amount, the wrong direction and a foreign workspace", async () => {
    const line = await lineBy("Bank fee");
    const wrong = await entry({ amountMinor: 700, description: "Other" });
    await expect(matchBankLine(owner, { lineId: line.id, entryId: wrong })).rejects.toThrow(/amount differs/);
    await expect(matchBankLine(foreign, { lineId: line.id, entryId: wrong })).rejects.toThrow(/unavailable/);
    await expect(setBankLineIgnored(foreign, { lineId: line.id, ignored: true })).rejects.toThrow(/unavailable/);
    await expect(matchBankLine(member, { lineId: line.id, entryId: wrong })).rejects.toThrow(/access/);
  });
  it("leaves a manual reconcile alone when the match is undone", async () => {
    const line = await prisma.financeBankLine.create({ data: { workspaceId: owner.workspace.id, statementId: (await prisma.financeBankStatement.findFirstOrThrow({ where: { accountId } })).id, accountId, postedOn: new Date("2026-06-20T00:00:00Z"), description: "Manual", amountMinor: -900, currency: "INR", lineHash: `manual-${suffix}` } });
    const e = await entry({ amountMinor: 900, occurredOn: "2026-06-20", description: "Manual" });
    const when = new Date("2026-06-21T00:00:00Z");
    await prisma.ledgerEntry.update({ where: { id: e }, data: { reconciledAt: when } });
    await matchBankLine(owner, { lineId: line.id, entryId: e });
    await unmatchBankLine(owner, { lineId: line.id });
    expect((await prisma.ledgerEntry.findFirstOrThrow({ where: { id: e } })).reconciledAt?.getTime()).toBe(when.getTime());
  });
  it("ignores and restores a line", async () => {
    const line = await lineBy("Bank fee");
    await setBankLineIgnored(owner, { lineId: line.id, ignored: true });
    expect((await lineBy("Bank fee")).status).toBe("IGNORED");
    await expect(setBankLineIgnored(owner, { lineId: line.id, ignored: true })).rejects.toThrow(/Only an unmatched/);
    await setBankLineIgnored(owner, { lineId: line.id, ignored: false });
  });
});

describe.sequential("create entry from a line", () => {
  it("goes through add-entry and links the new entry", async () => {
    const line = await lineBy("Donation");
    const out = await createEntryFromBankLine(owner, { lineId: line.id, description: "Workshop donation" });
    const created = await prisma.ledgerEntry.findFirstOrThrow({ where: { id: out.entryId } });
    expect(created).toMatchObject({ kind: "INCOME", amountMinor: 100000, accountId, description: "Workshop donation", reconciledAt: expect.any(Date) });
    expect((await lineBy("Donation")).status).toBe("MATCHED");
    await expect(createEntryFromBankLine(owner, { lineId: line.id })).rejects.toThrow(/already matched/);
  });
  it("respects a signed month and a reconciled period", async () => {
    await importFile(csv(["15/03/2026,March charge,-20.00,R9", "15/02/2026,Feb charge,-30.00,R10"]), "p.csv");
    await prisma.financeMonth.create({ data: { workspaceId: owner.workspace.id, month: "2026-03", signedOffAt: new Date() } });
    const march = await lineBy("March charge");
    await expect(createEntryFromBankLine(owner, { lineId: march.id })).rejects.toThrow(/signed off/);
    expect((await lineBy("March charge")).status).toBe("UNMATCHED");
    await prisma.financeAccount.update({ where: { id: accountId }, data: { reconciledUpTo: new Date("2026-02-28T00:00:00Z") } });
    const feb = await lineBy("Feb charge");
    await expect(createEntryFromBankLine(owner, { lineId: feb.id })).rejects.toThrow(/reconciled through/);
    expect(await prisma.ledgerEntry.count({ where: { workspaceId: owner.workspace.id, description: { in: ["March charge", "Feb charge"] } } })).toBe(0);
  });
});

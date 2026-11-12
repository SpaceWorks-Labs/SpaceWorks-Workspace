import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getWorkspaceForAction, type WorkspaceContext } from "@/lib/permissions";
import { addAccount } from "@/lib/finance/tools/close";
import { addEntry } from "@/lib/finance/tools/service";
import { buildAccountingExport, loadAccountingRows, saveExternalCodes } from "@/lib/finance/accounting-export";
import { GET } from "@/app/w/[workspaceSlug]/finance/export/accounting/[format]/route";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";


const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.id ? { user: { id: session.id } } : null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));

const suffix = uniqueSuffix();
const domain = `@acct-${suffix}.test`;
const slugs = [`ax-${suffix}`, `ax-other-${suffix}`];
let owner: WorkspaceContext, member: WorkspaceContext, foreign: WorkspaceContext;
let accountId: string, categoryId: string, foreignCategoryId: string, foreignAccountId: string;
const range = { from: "2026-06-01", to: "2026-06-30" };

const call = (slug: string, format: string, query: Record<string, string>) =>
  GET(new Request(`http://localhost/w/${slug}/finance/export/accounting/${format}?${new URLSearchParams(query)}`), { params: Promise.resolve({ workspaceSlug: slug, format }) } as never);

async function as(slug: string, id: string) {
  session.id = id;
  return (await getWorkspaceForAction(slug))!;
}

beforeAll(async () => {
  const [o, m] = await Promise.all(["owner", "member"].map((n) => createUser(`${n}${domain}`, n)));
  const w = await createWorkspace(slugs[0]!, o!.id);
  await createWorkspace(slugs[1]!, o!.id);
  await addMember(w.id, m!.id);
  owner = await as(slugs[0]!, o!.id);
  member = await as(slugs[0]!, m!.id);
  foreign = await as(slugs[1]!, o!.id);
  accountId = await addAccount(owner, { name: "Main bank", currency: "INR", openingMinor: 0, openingOn: "2026-01-01" });
  foreignAccountId = await addAccount(foreign, { name: "Other bank", currency: "INR", openingMinor: 0, openingOn: "2026-01-01" });
  categoryId = (await prisma.financeCategory.create({ data: { workspaceId: w.id, name: "Rent", kind: "EXPENSE" } })).id;
  foreignCategoryId = (await prisma.financeCategory.create({ data: { workspaceId: foreign.workspace.id, name: "Secret", kind: "EXPENSE", externalCode: "FOREIGN-LEDGER" } })).id;
  await addEntry(owner, { kind: "EXPENSE", amountMinor: 8000, currency: "INR", occurredOn: "2026-06-10", description: "June rent", accountId, categoryId });
  await addEntry(owner, { kind: "EXPENSE", amountMinor: 1200, currency: "INR", occurredOn: "2026-06-11", description: "Uncoded spend", accountId });
  await addEntry(foreign, { kind: "EXPENSE", amountMinor: 999, currency: "INR", occurredOn: "2026-06-10", description: "Foreign spend", accountId: foreignAccountId, categoryId: foreignCategoryId });
  await prisma.ledgerEntry.create({ data: { workspaceId: w.id, kind: "EXPENSE", amountMinor: 77700, currency: "INR", occurredOn: new Date("2026-06-12T00:00:00Z"), description: "Salary June private", accountId, categoryId, privatePayroll: true } });
}, 60000);
afterAll(async () => {
  await cleanup(slugs, domain);
  await prisma.$disconnect();
}, 60000);

describe.sequential("accounting export", () => {
  it("lists entries without a code as unmapped and never guesses", async () => {
    const { rows, unmapped } = await loadAccountingRows(owner, "journal", range);
    expect(rows).toHaveLength(0);
    expect(unmapped.map((u) => u.description).sort()).toEqual(["June rent", "Uncoded spend"]);
    expect(unmapped.find((u) => u.description === "June rent")!.reason).toMatch(/no ledger code/);
  });
  it("saves codes for this workspace only", async () => {
    await expect(saveExternalCodes(member, { categories: [], accounts: [] })).rejects.toThrow(/access/);
    await expect(saveExternalCodes(owner, { categories: [{ id: foreignCategoryId, code: "X" }], accounts: [] })).rejects.toThrow(/unavailable/);
    expect((await prisma.financeCategory.findFirstOrThrow({ where: { id: foreignCategoryId } })).externalCode).toBe("FOREIGN-LEDGER");
    await saveExternalCodes(owner, { categories: [{ id: categoryId, code: " Rent Expense " }], accounts: [{ id: accountId, code: "HDFC Bank" }] });
    expect((await prisma.financeCategory.findFirstOrThrow({ where: { id: categoryId } })).externalCode).toBe("Rent Expense");
  });
  it("exports only mapped, non-payroll, same-workspace entries", async () => {
    const tally = await buildAccountingExport(owner, "tally", range);
    expect(tally.count).toBe(1);
    expect(tally.unmapped).toHaveLength(1);
    expect(tally.body).toContain("Rent Expense");
    expect(tally.body).not.toMatch(/Salary|private|Foreign|FOREIGN/);
    const journal = await buildAccountingExport(owner, "journal", range);
    expect(journal.body).not.toMatch(/Salary|Foreign/);
    const xero = await buildAccountingExport(owner, "xero", { ...range, accountId });
    expect(xero.body).toContain("June rent");
    expect(xero.body).not.toMatch(/Salary|Foreign/);
    await expect(buildAccountingExport(owner, "xero", range)).rejects.toThrow(/one bank account/);
    await expect(buildAccountingExport(owner, "xero", { ...range, accountId: foreignAccountId })).rejects.toThrow(/account in this workspace/);
  });
  it("route: 409 until partial, then secure download with audit", async () => {
    const query = { from: range.from, to: range.to };
    expect((await call(slugs[0]!, "tally", query)).status).toBe(409);
    const ok = await call(slugs[0]!, "tally", { ...query, partial: "1" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    expect(ok.headers.get("Content-Disposition")).toMatch(/attachment; filename="accounting-tally-/);
    expect(await ok.text()).not.toContain("Salary");
    expect((await call(slugs[0]!, "nope", query)).status).toBe(404);
    expect((await call(slugs[0]!, "tally", { from: "2026-06-30", to: "2026-06-01" })).status).toBe(400);
    expect(await prisma.auditEvent.count({ where: { workspaceId: owner.workspace.id, action: "finance.accounting_export_downloaded" } })).toBe(1);
  });
  it("route: neutralises formulas in CSV cells", async () => {
    await addEntry(owner, { kind: "EXPENSE", amountMinor: 100, currency: "INR", occurredOn: "2026-07-01", description: "=HYPERLINK(\"http://x\")", accountId });
    const res = await call(slugs[0]!, "xero", { from: "2026-07-01", to: "2026-07-31", account: accountId });
    expect(await res.text()).toContain("'=HYPERLINK");
  });
  it("route: foreign and signed-out users get nothing", async () => {
    const query = { from: range.from, to: range.to, partial: "1" };
    const own = await call(slugs[1]!, "journal", query);
    expect(own.status).toBe(200);
    expect(await own.text()).not.toContain("June rent");
    session.id = "";
    expect((await call(slugs[0]!, "tally", query)).status).toBe(404);
    session.id = owner.user.id;
  });
});

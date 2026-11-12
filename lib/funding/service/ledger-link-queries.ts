import "server-only";
import { prisma } from "@/lib/db";
import { isoDay } from "@/lib/finance/dates";
import { assertActor, type Actor } from "./access";

/** Pickers and the "not yet in ledger" list for the donations page. */
export async function loadLedgerChoices(actor: Actor) {
  await assertActor(actor);
  const workspaceId = actor.workspace.id;
  const [funds, accounts, categories, gifts, pendingTotal] = await Promise.all([
    prisma.financeFund.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, name: true, currency: true, fcra: true }, orderBy: { name: "asc" } }),
    prisma.financeAccount.findMany({ where: { workspaceId }, select: { id: true, name: true, currency: true }, orderBy: { name: "asc" } }),
    prisma.financeCategory.findMany({ where: { workspaceId, kind: "INCOME", archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.fundingRecord.findMany({
      where: { workspaceId, kind: "DONATION", status: "RECEIVED", archivedAt: null, ledgerEntryId: null, details: { path: ["mode"], not: "IN_KIND" } },
      select: { id: true, title: true, amountMinor: true, currency: true, dateOn: true, fundId: true, contactId: true, details: true },
      orderBy: [{ dateOn: "desc" }, { id: "asc" }], take: 100,
    }),
    prisma.fundingRecord.count({ where: { workspaceId, kind: "DONATION", status: "RECEIVED", archivedAt: null, ledgerEntryId: null, details: { path: ["mode"], not: "IN_KIND" } } }),
  ]);
  const donors = new Map((await prisma.contact.findMany({ where: { workspaceId, id: { in: gifts.map((g) => g.contactId).filter((x): x is string => !!x) } }, select: { id: true, displayName: true } })).map((c) => [c.id, c.displayName]));
  return {
    funds, accounts, categories, pendingTotal,
    pending: gifts.map((g) => ({
      id: g.id, title: g.title, amountMinor: g.amountMinor, currency: g.currency, dateOn: g.dateOn ? isoDay(g.dateOn) : "",
      donor: donors.get(g.contactId ?? "") ?? "", foreign: (g.details as { foreignSource?: boolean }).foreignSource === true, fundId: g.fundId,
    })),
  };
}
export type LedgerChoices = Awaited<ReturnType<typeof loadLedgerChoices>>;

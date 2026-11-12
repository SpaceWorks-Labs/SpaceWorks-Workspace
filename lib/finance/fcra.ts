import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { toCsv } from "@/lib/finance/csv";
import { isoDay } from "@/lib/finance/dates";
import { minorToDecimalString } from "@/lib/finance/money";
import { FinanceError, financeAccess, type FinanceActor } from "@/lib/finance/tools/access";

export const FCRA_FUND_MESSAGE =
  "Foreign-source gifts must go to an FCRA fund. Choose a fund marked FCRA, or mark this fund as FCRA first.";

/** Blocks a foreign-source gift from posting to a fund that is not marked FCRA. */
export async function checkFcraFund(client: DbClient, workspaceId: string, foreign: boolean, fundId: string | null) {
  if (!foreign) return;
  const fund = fundId ? await client.financeFund.findFirst({ where: { id: fundId, workspaceId }, select: { fcra: true } }) : null;
  if (!fund?.fcra) throw new FinanceError(FCRA_FUND_MESSAGE);
}

/** Calendar quarter bounds (FCRA quarterly statements follow Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec). */
export function calendarQuarter(year: number, quarter: number) {
  const q = Math.min(4, Math.max(1, Math.trunc(quarter)));
  return { from: new Date(Date.UTC(year, (q - 1) * 3, 1)), to: new Date(Date.UTC(year, q * 3, 0)), quarter: q };
}

export const FCRA_CSV_HEAD = ["Date", "Donor", "Country", "Mode", "Amount", "Currency", "Fund", "Receipt number", "Posted to ledger"];

/**
 * Received gifts of the quarter that are foreign-source or sit in an FCRA fund.
 * Country comes from the gift's own details when present. Nothing else about the donor leaves the workspace.
 */
export async function fcraReceiptsCsv(actor: FinanceActor, year: number, quarter: number) {
  await financeAccess(actor, "MANAGE");
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new FinanceError("Choose a valid year.");
  const { from, to, quarter: q } = calendarQuarter(year, quarter);
  const workspaceId = actor.workspace.id;
  const rows = await prisma.fundingRecord.findMany({
    where: { workspaceId, kind: "DONATION", status: "RECEIVED", archivedAt: null, dateOn: { gte: from, lte: to }, details: { path: ["mode"], not: "IN_KIND" } },
    orderBy: [{ dateOn: "asc" }, { id: "asc" }],
  });
  // The fund a gift was posted to in the ledger wins over the fund noted on the gift itself.
  const posted = new Map((await prisma.ledgerEntry.findMany({ where: { workspaceId, id: { in: rows.map((r) => r.ledgerEntryId).filter((x): x is string => !!x) }, voidedAt: null }, select: { id: true, fundId: true } })).map((e) => [e.id, e.fundId]));
  const funds = new Map((await prisma.financeFund.findMany({ where: { workspaceId }, select: { id: true, name: true, fcra: true } })).map((f) => [f.id, f]));
  const fundOf = (r: (typeof rows)[number]) => funds.get((r.ledgerEntryId && posted.get(r.ledgerEntryId)) || r.fundId || "");
  const picked = rows.filter((r) => (r.details as { foreignSource?: boolean }).foreignSource === true || fundOf(r)?.fcra);
  const donors = new Map((await prisma.contact.findMany({ where: { workspaceId, id: { in: picked.map((r) => r.contactId).filter((x): x is string => !!x) } }, select: { id: true, displayName: true } })).map((c) => [c.id, c.displayName]));
  const body = picked.map((r) => {
    const d = r.details as { mode?: string; country?: string; receiptNumber?: string };
    return [isoDay(r.dateOn!), donors.get(r.contactId ?? "") ?? "", d.country ?? "", d.mode ?? "", minorToDecimalString(r.amountMinor, r.currency), r.currency, fundOf(r)?.name ?? "", r.receiptNumber ?? d.receiptNumber ?? "", r.ledgerEntryId ? "Yes" : "No"];
  });
  return { csv: toCsv([[`FCRA receipts ${year} Q${q}`], FCRA_CSV_HEAD, ...body]), count: body.length, quarter: q };
}

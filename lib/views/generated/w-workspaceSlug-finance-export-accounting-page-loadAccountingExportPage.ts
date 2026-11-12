// Generated from app/w/[workspaceSlug]/finance/export/accounting/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadAccountingRows } from "@/lib/finance/accounting-export";
import { isAccountingFormat, type AccountingFormat } from "@/lib/finance/accounting-export/types";
import { dateOnly, localDate } from "@/lib/finance/dates";
import { FinanceError } from "@/lib/finance/tools/access";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";

export async function loadAccountingExportPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/finance/export/accounting">) {
const { workspaceSlug } = await params;
const query = await searchParams;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewFinance(membership, workspace)) notFound();
const today = localDate(new Date(), workspace.timezone);
const day = (v: string, fallback: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && dateOnly(v).toISOString().slice(0, 10) === v ? v : fallback);
const from = day(one(query.from), `${today.slice(0, 7)}-01`);
const to = day(one(query.to), today);
const format = isAccountingFormat(one(query.format)) ? (one(query.format) as AccountingFormat) : "tally";
const accountId = one(query.account);
const journalLedger = one(query.journalLedger).slice(0, 100);
const actor = { user, workspace, membership };
const [accounts, categories] = await Promise.all([
    prisma.financeAccount.findMany({ where: { workspaceId: workspace.id }, orderBy: { name: "asc" }, select: { id: true, name: true, currency: true, externalCode: true } }),
    prisma.financeCategory.findMany({ where: { workspaceId: workspace.id, archivedAt: null }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true, externalCode: true } }),
  ]);
let preview: Awaited<ReturnType<typeof loadAccountingRows>> = { rows: [], unmapped: [] };
let error: string | null = null;
if (from > to) error = "Choose an end date after the start date.";
  else
    try {
      preview = await loadAccountingRows(actor, format, { from, to, accountId: accountId || null, journalLedger: journalLedger || null });
    } catch (e) {
      if (!(e instanceof FinanceError)) throw e;
      error = e.message;
    }
const canManage = canManageFinance(membership);
return viewDto({ workspace, from, to, format, accountId, journalLedger, accounts, categories, preview, error, canManage } as const);
}

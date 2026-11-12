// Generated from app/w/[workspaceSlug]/finance/bank/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { BANK_PAGE_SIZE, loadBankView } from "@/lib/finance/bank";
import { FinanceError } from "@/lib/finance/tools/access";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";

export async function loadBankPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/finance/bank">) {
const { workspaceSlug } = await params;
const query = await searchParams;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewFinance(membership, workspace)) notFound();
const canManage = canManageFinance(membership);
const view = await loadBankView({ user, workspace, membership }, { accountId: one(query.account), status: one(query.status), page: one(query.page) }).catch((e: unknown) => {
    if (e instanceof FinanceError) notFound();
    throw e;
  });
const base = `/w/${workspace.slug}/finance/bank`;
const [categories, funds, centres] = canManage && view.account
    ? await Promise.all([
        prisma.financeCategory.findMany({ where: { workspaceId: workspace.id, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
        prisma.financeFund.findMany({ where: { workspaceId: workspace.id, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, currency: true } }),
        prisma.financeCostCentre.findMany({ where: { workspaceId: workspace.id, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      ])
    : [[], [], []];
const status = one(query.status) ?? "";
const page = Math.max(1, Number.parseInt(one(query.page) ?? "1", 10) || 1);
const pages = Math.max(1, Math.ceil(view.total / BANK_PAGE_SIZE));
return viewDto({ workspace, canManage, view, base, categories, funds, centres, status, page, pages } as const);
}

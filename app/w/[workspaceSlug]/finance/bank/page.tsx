import Link from "next/link";
import { notFound } from "next/navigation";
import { BankImport } from "@/components/finance/bank/BankImport";
import { BankLines } from "@/components/finance/bank/BankLines";
import { Card, CardHeader, Chip, EmptyState, SectionHeading } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { BANK_PAGE_SIZE, loadBankView } from "@/lib/finance/bank";
import { FinanceError } from "@/lib/finance/tools/access";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";
import { formatMoney } from "@/lib/format/money";

export const metadata = { title: "Bank" };

export default async function BankPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/finance/bank">) {
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
  if (!view.account)
    return (
      <div className="flex flex-col gap-5">
        <SectionHeading title="Bank statements" description="Import a bank statement and match each line to a ledger entry." />
        <EmptyState title="Add a bank account first">Bank lines belong to an account. Create one in Month-end, then come back.</EmptyState>
      </div>
    );
  const link = (p: number) => `${base}?account=${view.account!.id}${status ? `&status=${status}` : ""}&page=${p}`;
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading title="Bank statements" description="Import a statement, then match each line to a ledger entry. Matching marks the entry reconciled." />
      <nav aria-label="Account" className="flex flex-wrap gap-2">
        {view.accounts.map((a) => (
          <Link key={a.id} href={`${base}?account=${a.id}`} aria-current={a.id === view.account!.id ? "page" : undefined} className={`rounded-full px-3 py-1 text-label ${a.id === view.account!.id ? "bg-primary text-on-primary" : "bg-surface text-ink-secondary hover:text-ink"}`}>
            {a.name}
          </Link>
        ))}
      </nav>
      {canManage ? <BankImport slug={workspace.slug} accountId={view.account.id} accountName={view.account.name} currency={view.account.currency} /> : null}
      <Card padding="lg">
        <CardHeader title="Matching" description={`${view.unmatchedCount} unmatched ${view.unmatchedCount === 1 ? "line" : "lines"} in ${view.account.name}. Suggestions need the same amount within three days.`} />
        <div className="mt-4">
          <BankLines slug={workspace.slug} base={base} accountId={view.account.id} status={status} lines={view.lines} options={{ categories, funds, centres }} canManage={canManage} />
        </div>
        {pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-label text-ink-secondary">
            {page > 1 ? <Link href={link(page - 1)}>Previous</Link> : <span />}
            <span>Page {page} of {pages}</span>
            {page < pages ? <Link href={link(page + 1)}>Next</Link> : <span />}
          </div>
        ) : null}
      </Card>
      {view.statements.length ? (
        <Table label="Imported statements">
          <THead><TR><TH>File</TH><TH>Imported</TH><TH>Period</TH><TH className="text-right">Lines</TH><TH className="text-right">Closing</TH></TR></THead>
          <TBody>
            {view.statements.map((s) => (
              <TR key={s.id}>
                <TD>{s.filename} <Chip size="sm">{s.format}</Chip></TD>
                <TD className="whitespace-nowrap tabular-nums">{s.importedAt.toISOString().slice(0, 10)}</TD>
                <TD className="whitespace-nowrap tabular-nums">{s.fromDate?.toISOString().slice(0, 10) ?? "-"} to {s.toDate?.toISOString().slice(0, 10) ?? "-"}</TD>
                <TD className="text-right tabular-nums">{s.rowCount}</TD>
                <TD className="whitespace-nowrap text-right tabular-nums">{s.closingMinor === null ? "-" : formatMoney(s.closingMinor, view.account!.currency)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}
    </div>
  );
}

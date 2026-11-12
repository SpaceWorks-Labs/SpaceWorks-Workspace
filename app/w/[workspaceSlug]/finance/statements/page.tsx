import { notFound } from "next/navigation";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";
import { loadStatements } from "@/lib/finance/statements/load";
import { StatementsView } from "@/components/finance/statements/StatementsView";
import { StatementControls } from "@/components/finance/statements/StatementControls";
import { StatementSettings } from "@/components/finance/statements/StatementSettings";

export const metadata = { title: "Statements" };

export default async function Page({ params, searchParams }: PageProps<"/w/[workspaceSlug]/finance/statements">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewFinance(actor.membership, actor.workspace)) notFound();
  const raw = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const data = await loadStatements(actor, { year: Number(one(raw.year)) || undefined, currency: one(raw.currency) });
  const base = `/w/${workspaceSlug}/finance/statements`;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-h2">Statements, financial year {data.range.label}</h2>
        <p className="text-ink-muted">Receipts and Payments, Income and Expenditure, and a fund statement from your ledger.</p>
      </div>
      <StatementControls base={base} data={data} />
      {canManageFinance(actor.membership) ? <StatementSettings slug={workspaceSlug} startMonth={data.startMonth} funds={data.fundList} fcraCsvHref={`${base}/fcra`} /> : null}
      <StatementsView data={data} />
    </div>
  );
}

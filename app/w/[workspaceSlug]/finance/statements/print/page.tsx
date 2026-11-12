import { notFound } from "next/navigation";
import { canViewFinance, requireWorkspace } from "@/lib/permissions";
import { loadStatements } from "@/lib/finance/statements/load";
import { StatementsView } from "@/components/finance/statements/StatementsView";
import { PrintButton } from "@/components/finance/PrintButton";
import "../../tools-print.css";

export const metadata = { title: "Statements" };

export default async function Page({ params, searchParams }: PageProps<"/w/[workspaceSlug]/finance/statements/print">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewFinance(actor.membership, actor.workspace)) notFound();
  const raw = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const data = await loadStatements(actor, { year: Number(one(raw.year)) || undefined, currency: one(raw.currency) });
  return (
    <div id="finance-print" className="flex flex-col gap-4">
      <h2 className="text-h2">{actor.workspace.name}: statements, financial year {data.range.label} ({data.currency})</h2>
      <div className="print:hidden"><PrintButton /></div>
      <StatementsView data={data} />
    </div>
  );
}

import Link from "next/link";
import { requireWorkspace } from "@/lib/permissions";
import { canManageFinance, canManageAssets } from "@/lib/roles";
import { listStock, recentMovements } from "@/lib/makerspace/stock";
import { saveStock } from "@/app/actions/stock";
import { OpsForm } from "@/components/requests/OpsForm";
import { PersistentSection } from "@/components/stock/PersistentSection";
import { StockItemCard } from "@/components/stock/StockItemCard";
import { Card, EmptyState, PageHeader, StatTile } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { ListLayout } from "@/components/ui/layouts";

export const metadata = { title: "Stock" };
const SHOWN = 200;

export default async function StockPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/stock">) {
  const { workspaceSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
  const low = sp.low === "1";
  const archived = sp.archived === "1";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const canManage = canManageAssets(ctx.membership);
  const [items, all] = await Promise.all([listStock(ctx, { low, q, archived }), listStock(ctx)]);
  const shown = items.slice(0, SHOWN);
  const movements = await recentMovements(ctx, shown.map((item) => item.id));
  const lowCount = all.filter((item) => item.low).length;
  const base = `/w/${workspaceSlug}/stock`;
  const query = (extra: Record<string, string>) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...extra })}`;
  return (
    <ListLayout
      header={
        <PageHeader
          title="Stock"
          description="Consumables and parts, with reorder alerts when something runs low."
          actions={<a href={`${base}/export${query(low ? { low: "1" } : {})}`} className={buttonClasses({ variant: "secondary" })}>Export CSV</a>}
        />
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-3">
          <StatTile label="Items" value={all.length} />
          <StatTile label="Low stock" value={lowCount} tone={lowCount ? "attention" : "default"} href={low ? base : `${base}?low=1`} />
          <form className="ml-auto flex min-w-0 items-center gap-2" action={base}>
            <input name="q" defaultValue={q} aria-label="Search stock" placeholder="Search name or SKU" maxLength={80} className="min-h-11 min-w-0 rounded-md border border-line bg-panel px-3 text-body-ui" />
            {low ? <input type="hidden" name="low" value="1" /> : null}
            <button className={buttonClasses({ variant: "secondary" })}>Search</button>
          </form>
          <Link href={low ? `${base}${query({})}` : `${base}${query({ low: "1" })}`} className="inline-flex min-h-11 items-center text-accent-text underline">{low ? "Show all items" : "Only low stock"}</Link>
          {canManage ? <Link href={archived ? base : `${base}?archived=1`} className="inline-flex min-h-11 items-center text-accent-text underline">{archived ? "Show active" : "Show archived"}</Link> : null}
        </div>
      }
    >
      {canManage ? (
        <Card>
          <PersistentSection id="stock-add" title="Add a stock item" defaultOpen={!all.length}>
            <OpsForm
              action={saveStock.bind(null, workspaceSlug)}
              label="Add item"
              fields={[
                { name: "name", label: "Name", required: true },
                { name: "sku", label: "SKU" },
                { name: "unit", label: "Unit", value: "pcs", required: true },
                { name: "location", label: "Location" },
                { name: "preferredVendor", label: "Preferred vendor" },
                { name: "cost", label: "Unit cost" },
                { name: "reorderLevel", label: "Reorder level" },
                { name: "reorderQty", label: "Reorder quantity" },
                { name: "openingQty", label: "Opening quantity" },
              ]}
            />
          </PersistentSection>
        </Card>
      ) : null}
      {!shown.length ? <EmptyState patch>{low ? "Nothing is below its reorder level." : "No stock items yet. Ask an admin to add the first one."}</EmptyState> : null}
      {shown.map((item) => (
        <StockItemCard key={item.id} slug={workspaceSlug} item={{ ...item, onHand: item.onHand.toString(), reorderLevel: item.reorderLevel?.toString() ?? null, reorderQty: item.reorderQty?.toString() ?? null }} movements={(movements.get(item.id) ?? []).map((m) => ({ ...m, quantity: m.quantity.toString() }))} canManage={canManage} canFinance={canManageFinance(ctx.membership)} timeZone={ctx.workspace.timezone} />
      ))}
      {items.length > SHOWN ? <p className="text-caption text-ink-muted">Showing the first {SHOWN} of {items.length}. Search to narrow the list.</p> : null}
    </ListLayout>
  );
}

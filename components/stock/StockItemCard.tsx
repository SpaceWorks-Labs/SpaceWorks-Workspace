import { archiveStock, moveStock, saveStock } from "@/app/actions/stock";
import { OpsForm } from "@/components/requests/OpsForm";
import { Card, Chip } from "@/components/ui/display";
import { currencyMinorDigits, formatMoney } from "@/lib/format/money";
import { formatDayTime } from "@/lib/format/datetime";
import { PersistentSection } from "./PersistentSection";
import type { StockItem, StockMovement } from "@prisma/client";

const KINDS = [
  { value: "RECEIVE", label: "Receive" },
  { value: "ISSUE", label: "Issue" },
  { value: "SALE", label: "Sale" },
  { value: "ADJUST", label: "Adjust (use a minus to remove)" },
];

// Quantities arrive as strings so the card stays plain data in both the monolith and the split frontend.
export type StockCardItem = Omit<StockItem, "onHand" | "reorderLevel" | "reorderQty"> & { onHand: string; reorderLevel: string | null; reorderQty: string | null; low: boolean };
export type StockCardMovement = Omit<StockMovement, "quantity"> & { quantity: string };

export function StockItemCard({ slug, item, movements, canManage, canFinance, timeZone }: { slug: string; item: StockCardItem; movements: StockCardMovement[]; canManage: boolean; canFinance: boolean; timeZone: string }) {
  const bound = (action: typeof saveStock) => action.bind(null, slug);
  return (
    <Card id={item.id} className="sw-rise-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h4 break-words">{item.name}</h2>
          <p className="mt-2 text-body-ui text-ink-muted">
            {[item.sku, item.location ?? "No location", item.preferredVendor ? `Vendor: ${item.preferredVendor}` : null, canManage && item.costMinor !== null ? `${formatMoney(item.costMinor, item.currency)} each` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.low ? <Chip tone="warning">Low stock</Chip> : <Chip tone="success">In stock</Chip>}
          <span className="text-title tabular-nums">{item.onHand.toString()} {item.unit}</span>
        </div>
      </div>
      {item.reorderLevel ? <p className="mt-2 text-caption text-ink-muted">Reorder at {item.reorderLevel.toString()} {item.unit}{item.reorderQty ? `, order ${item.reorderQty.toString()}` : ""}.</p> : null}
      {canManage ? (
        <div className="mt-3">
          <PersistentSection id={`stock-move-${item.id}`} title="Move stock">
            <OpsForm
              action={moveStock.bind(null, slug)}
              hidden={{ itemId: item.id }}
              label="Record movement"
              fields={[
                { name: "kind", label: "Type", value: "RECEIVE", required: true, options: KINDS },
                { name: "quantity", label: `Quantity (${item.unit})`, required: true },
                { name: "note", label: "Note" },
                ...(canFinance ? [{ name: "totalCost", label: "Total cost paid (receive only)", helper: "Leave empty to use the unit cost." }, { name: "postToLedger", label: "Post this purchase to the ledger", type: "checkbox" }] : []),
              ]}
            />
          </PersistentSection>
          <PersistentSection id={`stock-edit-${item.id}`} title="Edit item">
            <OpsForm
              action={bound(saveStock)}
              hidden={{ id: item.id }}
              label="Save item"
              fields={[
                { name: "name", label: "Name", value: item.name, required: true },
                { name: "sku", label: "SKU", value: item.sku ?? "" },
                { name: "unit", label: "Unit", value: item.unit, required: true },
                { name: "location", label: "Location", value: item.location ?? "" },
                { name: "preferredVendor", label: "Preferred vendor", value: item.preferredVendor ?? "" },
                { name: "reorderLevel", label: "Reorder level", value: item.reorderLevel?.toString() ?? "" },
                { name: "reorderQty", label: "Reorder quantity", value: item.reorderQty?.toString() ?? "" },
                { name: "cost", label: "Unit cost", value: item.costMinor === null ? "" : (item.costMinor / 10 ** currencyMinorDigits(item.currency)).toFixed(currencyMinorDigits(item.currency)) },
              ]}
            />
            <div className="mt-4">
              <OpsForm action={bound(archiveStock)} hidden={{ id: item.id, archived: item.archivedAt ? "false" : "true" }} label={item.archivedAt ? "Restore item" : "Archive item"} confirm={item.archivedAt ? undefined : "Archive this item? Its history stays."} />
            </div>
          </PersistentSection>
        </div>
      ) : null}
      <PersistentSection id={`stock-history-${item.id}`} title="Recent movements" count={movements.length}>
        {movements.length ? movements.map((m) => <p key={m.id} className="text-body-ui">{formatDayTime(m.createdAt, timeZone)}: {m.kind.toLowerCase()} {m.quantity.toString()} {item.unit}{m.note ? `, ${m.note}` : ""}</p>) : <p className="text-body-ui text-ink-muted">No movements yet.</p>}
      </PersistentSection>
    </Card>
  );
}

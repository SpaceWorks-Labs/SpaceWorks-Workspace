import "server-only";
import { toCsv } from "@/lib/finance/csv";
import type { OpsActor } from "@/lib/approvals/context";
import { listStock } from "./items";

/** Stock CSV with formula-leading cells neutralised by the shared `csvCell` writer. */
export async function stockCsv(actor: OpsActor, filter: { low?: boolean } = {}, costs = false): Promise<string> {
  const items = await listStock(actor, filter);
  return toCsv([
    ["Name", "SKU", "Unit", "Location", "On hand", "Reorder level", "Reorder quantity", "Preferred vendor", ...(costs ? ["Unit cost (minor units)", "Currency"] : []), "Low"],
    ...items.map((item) => [item.name, item.sku, item.unit, item.location, item.onHand.toString(), item.reorderLevel?.toString(), item.reorderQty?.toString(), item.preferredVendor, ...(costs ? [item.costMinor, item.currency] : []), item.low ? "Yes" : "No"]),
  ]);
}

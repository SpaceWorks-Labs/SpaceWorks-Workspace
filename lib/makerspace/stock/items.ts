import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { OpsActor } from "@/lib/approvals/context";
import { guard, id, note, OpsError, parse } from "@/lib/approvals/ops";
import { parseMoneyToMinor } from "@/lib/format/money";
import { applyMovement, notifyReorder } from "./movements";
import { crossedIntoLow, isLow } from "./quantity";
import { itemSchema } from "./schemas";

export type StockFilter = { low?: boolean; q?: string; archived?: boolean };

/** Items for the stock page; `low` keeps those at or below their reorder level. */
export async function listStock(actor: OpsActor, filter: StockFilter = {}) {
  await guard(actor);
  const q = filter.q?.trim();
  const rows = await prisma.stockItem.findMany({
    where: {
      workspaceId: actor.workspace.id,
      archivedAt: filter.archived ? { not: null } : null,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { name: "asc" },
    take: 1000,
  });
  const items = rows.map((row) => ({ ...row, low: isLow(row.onHand, row.reorderLevel) }));
  return filter.low ? items.filter((item) => item.low) : items;
}

/** Latest movements (up to five each) for the listed items, in one query. */
export async function recentMovements(actor: OpsActor, itemIds: string[]) {
  await guard(actor);
  const rows = await prisma.stockMovement.findMany({ where: { workspaceId: actor.workspace.id, itemId: { in: itemIds } }, orderBy: { createdAt: "desc" }, take: 1000 });
  const byItem = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byItem.get(row.itemId) ?? [];
    if (list.length < 5) byItem.set(row.itemId, [...list, row]);
  }
  return byItem;
}

export async function saveStockItem(actor: OpsActor, input: unknown): Promise<string> {
  await guard(actor, true);
  const { id: itemId, cost, openingQty, ...v } = parse(itemSchema, input);
  const currency = actor.workspace.currency ?? "INR";
  const costMinor = cost === undefined ? null : parseMoneyToMinor(cost, currency);
  if (cost !== undefined && costMinor === null) throw new OpsError("Enter a valid cost for this currency.");
  const data = { name: v.name, sku: v.sku ?? null, unit: v.unit, location: v.location ?? null, preferredVendor: v.preferredVendor ?? null, costMinor, currency, reorderLevel: v.reorderLevel ?? null, reorderQty: v.reorderQty ?? null };
  const dispatched = await prisma.$transaction(async (tx) => {
    if (!itemId) {
      const row = await tx.stockItem.create({ data: { ...data, workspaceId: actor.workspace.id } });
      if (openingQty && Number(openingQty) > 0) await applyMovement(tx, actor, { itemId: row.id, kind: "ADJUST", quantity: openingQty, note: "Opening balance" });
      await note(actor, "stock", row.id, "item_created", tx);
      return { id: row.id, after: undefined };
    }
    const rows = await tx.$queryRaw<{ onHand: Prisma.Decimal; reorderLevel: Prisma.Decimal | null }[]>`SELECT "onHand", "reorderLevel" FROM "StockItem" WHERE "id" = ${itemId} AND "workspaceId" = ${actor.workspace.id} FOR UPDATE`;
    const prev = rows[0];
    if (!prev) throw new OpsError("That stock item is unavailable.");
    const row = await tx.stockItem.update({ where: { id: itemId, workspaceId: actor.workspace.id }, data });
    await note(actor, "stock", row.id, "item_updated", tx);
    // Raising the level can put an item below it without any movement.
    const after = crossedIntoLow(prev, { onHand: row.onHand, reorderLevel: row.reorderLevel }) ? await notifyReorder(tx, actor, row, `level:${row.id}:${Date.now()}`) : undefined;
    return { id: row.id, after };
  });
  await dispatched.after?.();
  return dispatched.id;
}

export async function setStockArchived(actor: OpsActor, input: unknown) {
  await guard(actor, true);
  const v = parse(z.object({ id, archived: z.boolean() }), input);
  const { count } = await prisma.stockItem.updateMany({ where: { id: v.id, workspaceId: actor.workspace.id }, data: { archivedAt: v.archived ? new Date() : null } });
  if (!count) throw new OpsError("That stock item is unavailable.");
  await note(actor, "stock", v.id, v.archived ? "item_archived" : "item_restored");
}

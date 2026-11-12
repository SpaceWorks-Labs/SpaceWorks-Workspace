import "server-only";
import { Prisma, type StockItem } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { memberIdsAtLeast, type OpsActor } from "@/lib/approvals/context";
import { guard, note, OpsError, parse } from "@/lib/approvals/ops";
import { crossedIntoLow, movementDelta, type MovementKind } from "./quantity";
import { movementSchema } from "./schemas";

type Tx = Prisma.TransactionClient;
type MovementInput = { itemId: string; kind: MovementKind; quantity: string; note?: string };
type Locked = { id: string; name: string; unit: string; onHand: Prisma.Decimal; reorderLevel: Prisma.Decimal | null; costMinor: number | null; preferredVendor: string | null };

/** Queue the reorder alert inside the caller's transaction; the returned function runs after commit. */
export async function notifyReorder(tx: Tx, actor: OpsActor, item: Pick<StockItem, "id" | "name" | "unit" | "onHand" | "reorderLevel">, dedupeKey: string) {
  const result = await dispatch(
    actor.workspace.id,
    {
      type: "stock.reorder",
      title: `${item.name} is below its reorder level`,
      body: `On hand: ${item.onHand.toString()} ${item.unit}. Reorder level: ${item.reorderLevel?.toString() ?? ""} ${item.unit}.`,
      url: `/w/${actor.workspace.slug}/stock?low=1`,
      actorId: actor.user.id,
      recipients: await memberIdsAtLeast(tx, actor.workspace.id, "ADMIN"),
      resource: { type: "stock_item", id: item.id },
      dedupeKey: `stock:${dedupeKey}`,
      data: { itemId: item.id, onHand: item.onHand.toString(), reorderLevel: item.reorderLevel?.toString() ?? "0" },
    },
    { tx },
  );
  return () => result.afterCommit();
}

/**
 * Lock the item row, apply the movement and keep `onHand` in step, all inside the caller's
 * transaction. The row lock makes concurrent movements serial, so the reorder event fires once.
 * Returns the movement id plus the post-commit hook for the alert.
 */
export async function applyMovement(tx: Tx, actor: OpsActor, v: MovementInput) {
  const rows = await tx.$queryRaw<Locked[]>`SELECT "id", "name", "unit", "onHand", "reorderLevel", "costMinor", "preferredVendor" FROM "StockItem" WHERE "id" = ${v.itemId} AND "workspaceId" = ${actor.workspace.id} AND "archivedAt" IS NULL FOR UPDATE`;
  const item = rows[0];
  if (!item) throw new OpsError("That stock item is unavailable.");
  const prevOnHand = new Prisma.Decimal(item.onHand);
  const nextOnHand = prevOnHand.add(movementDelta(v.kind, v.quantity));
  if (nextOnHand.isNeg()) throw new OpsError(`Only ${prevOnHand.toString()} ${item.unit} on hand. Lower the quantity.`);
  await tx.stockItem.update({ where: { id: item.id }, data: { onHand: nextOnHand } });
  const stored = v.kind === "ADJUST" ? new Prisma.Decimal(v.quantity) : new Prisma.Decimal(v.quantity).abs();
  const movement = await tx.stockMovement.create({ data: { workspaceId: actor.workspace.id, itemId: item.id, kind: v.kind, quantity: stored, note: v.note ?? null, createdById: actor.user.id } });
  await note(actor, "stock", item.id, "moved", tx);
  const after = crossedIntoLow({ onHand: prevOnHand, reorderLevel: item.reorderLevel }, { onHand: nextOnHand, reorderLevel: item.reorderLevel })
    ? await notifyReorder(tx, actor, { id: item.id, name: item.name, unit: item.unit, onHand: nextOnHand, reorderLevel: item.reorderLevel }, `move:${movement.id}`)
    : undefined;
  return { movementId: movement.id, item: { ...item, onHand: nextOnHand }, after };
}

export async function recordMovement(actor: OpsActor, input: unknown) {
  await guard(actor, true);
  const v = parse(movementSchema, input);
  const done = await prisma.$transaction((tx) => applyMovement(tx, actor, v), { timeout: 15_000 });
  await done.after?.();
  return { movementId: done.movementId, onHand: done.item.onHand.toString(), unit: done.item.unit, costMinor: done.item.costMinor, name: done.item.name, vendor: done.item.preferredVendor, quantity: v.quantity };
}

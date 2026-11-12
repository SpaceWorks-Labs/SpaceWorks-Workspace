import { Prisma } from "@prisma/client";

/** Pure stock arithmetic (no database), shared by the movement service and unit tests. */
export const MOVEMENT_KINDS = ["RECEIVE", "ISSUE", "ADJUST", "SALE"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
type Num = Prisma.Decimal | string | number;
const dec = (value: Num) => new Prisma.Decimal(value);

/** Change to on-hand. RECEIVE adds, ISSUE and SALE remove, ADJUST is the signed quantity itself. */
export function movementDelta(kind: MovementKind, quantity: Num): Prisma.Decimal {
  const q = dec(quantity);
  if (kind === "RECEIVE") return q.abs();
  if (kind === "ADJUST") return q;
  return q.abs().neg();
}

/** An item is low at or below its reorder level; no level means never low. */
export function isLow(onHand: Num, reorderLevel: Num | null | undefined): boolean {
  return reorderLevel !== null && reorderLevel !== undefined && dec(onHand).lte(dec(reorderLevel));
}

/**
 * True only on the transition from not-low to low, so the alert fires once and
 * re-arms by itself when stock goes back above the level.
 */
export function crossedIntoLow(prev: { onHand: Num; reorderLevel: Num | null | undefined }, next: { onHand: Num; reorderLevel: Num | null | undefined }): boolean {
  return !isLow(prev.onHand, prev.reorderLevel) && isLow(next.onHand, next.reorderLevel);
}

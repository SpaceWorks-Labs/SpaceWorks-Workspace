import { z } from "zod";
import { id, optionalId, title } from "@/lib/approvals/ops";
import { MOVEMENT_KINDS } from "./quantity";

const blank = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" || v === null ? undefined : v), schema.optional());
const text = (max: number) => blank(z.string().trim().max(max));
const quantity = z.string().trim().regex(/^\d{1,9}(\.\d{1,3})?$/, "Enter a quantity with up to 3 decimals.");
const signedQuantity = z.string().trim().regex(/^-?\d{1,9}(\.\d{1,3})?$/, "Enter a quantity with up to 3 decimals.");

export const itemSchema = z.object({
  id: optionalId,
  name: title,
  sku: text(80),
  unit: z.string().trim().min(1, "Enter a unit, such as pcs or m.").max(20),
  location: text(200),
  preferredVendor: text(200),
  reorderLevel: blank(quantity),
  reorderQty: blank(quantity),
  cost: blank(z.string().trim().max(24)),
  openingQty: blank(quantity),
});

export const movementSchema = z
  .object({ itemId: id, kind: z.enum(MOVEMENT_KINDS), quantity: signedQuantity, note: text(500) })
  .superRefine((v, ctx) => {
    if (Number(v.quantity) === 0) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Enter a quantity above zero." });
    if (v.kind !== "ADJUST" && v.quantity.startsWith("-")) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Enter a positive quantity. Use Adjust to correct a count." });
  });

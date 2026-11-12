import "server-only";
import { Prisma, type WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actionError, NOT_ALLOWED, type ActionResult } from "@/lib/actionResult";
import { canManageFinance } from "@/lib/roles";
import { createLedgerEntry } from "@/lib/finance/service/ledger";
import type { Ctx } from "@/lib/finance/service/mutation-helpers";
import { ledgerEntrySchema } from "@/lib/finance/schemas";
import { localDate } from "@/lib/finance/dates";
import { currencyMinorDigits, parseMoneyToMinor } from "@/lib/format/money";

export type ReceiptToPost = { movementId: string; name: string; vendor: string | null; quantity: string; unitCostMinor: number | null; totalCost?: string };

/**
 * Optional: post a RECEIVE as a ledger expense and remember the entry id on the movement.
 * Finance rules stay with the finance service (closed periods, amounts); this only maps the fields.
 */
export async function postReceiptToLedger(ctx: Ctx & { membership: { role: WorkspaceRole } }, receipt: ReceiptToPost): Promise<ActionResult<{ ledgerEntryId: string }>> {
  if (!canManageFinance(ctx.membership)) return actionError(NOT_ALLOWED);
  const { currency, timezone } = ctx.workspace;
  const totalMinor = receipt.totalCost
    ? parseMoneyToMinor(receipt.totalCost, currency)
    : receipt.unitCostMinor === null ? null : new Prisma.Decimal(receipt.quantity).mul(receipt.unitCostMinor).round().toNumber();
  if (totalMinor === null || totalMinor <= 0) return actionError("Add a cost or set the item's unit cost to post this purchase.");
  const digits = currencyMinorDigits(currency);
  const values = ledgerEntrySchema.parse({
    kind: "EXPENSE",
    amount: (totalMinor / 10 ** digits).toFixed(digits),
    occurredOn: localDate(new Date(), timezone),
    description: `Stock received: ${receipt.name}`.slice(0, 200),
    counterparty: receipt.vendor ?? undefined,
  });
  const posted = await createLedgerEntry(ctx, values, null);
  if (!posted.ok) return posted;
  const ledgerEntryId = posted.data!.id;
  await prisma.stockMovement.updateMany({ where: { id: receipt.movementId, workspaceId: ctx.workspace.id }, data: { ledgerEntryId } });
  return { ok: true, data: { ledgerEntryId } };
}

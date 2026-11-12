"use server";
import { revalidatePath } from "@/lib/frontend/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { type ActionResult, NOT_ALLOWED, RATE_LIMITED, SAVE_FAILED } from "@/lib/actionResult";
import { runAction, values } from "@/lib/approvals/action";
import { OpsError } from "@/lib/approvals/ops";
import { recordMovement, postReceiptToLedger, saveStockItem, setStockArchived } from "@/lib/makerspace/stock";
import { canManageFinance } from "@/lib/roles";

export async function saveStock(slug: string, form: FormData) {
  return runAction(slug, "stock", async (a) => { await saveStockItem(a, values(form)); }, true);
}
export async function archiveStock(slug: string, form: FormData) {
  return runAction(slug, "stock", async (a) => { await setStockArchived(a, { id: String(form.get("id") ?? ""), archived: form.get("archived") !== "false" }); }, true);
}

/** Record a movement. A RECEIVE can also post the purchase to the ledger when the user can manage finance. */
export async function moveStock(slug: string, form: FormData): Promise<ActionResult<string>> {
  const ctx = await getWorkspaceForAction(slug, "ADMIN", { module: "services" });
  if (!ctx) return { ok: false, error: NOT_ALLOWED };
  if (await isActionRateLimited("apiWrite", ctx.user.id)) return { ok: false, error: RATE_LIMITED };
  const input = values(form);
  try {
    const moved = await recordMovement(ctx, input);
    let message = `Saved. ${moved.onHand} ${moved.unit} on hand.`;
    if (input.kind === "RECEIVE" && form.get("postToLedger") === "on" && canManageFinance(ctx.membership)) {
      const posted = await postReceiptToLedger(ctx, { movementId: moved.movementId, name: moved.name, vendor: moved.vendor, quantity: moved.quantity, unitCostMinor: moved.costMinor, totalCost: input.totalCost || undefined });
      message += posted.ok ? " Posted to the ledger." : ` Not posted to the ledger: ${posted.error}`;
    }
    revalidatePath(`/w/${ctx.workspace.slug}/stock`, "layout");
    return { ok: true, data: message };
  } catch (error) {
    return { ok: false, error: error instanceof OpsError ? error.message : SAVE_FAILED };
  }
}

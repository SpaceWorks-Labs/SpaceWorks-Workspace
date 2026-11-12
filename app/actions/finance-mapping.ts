"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspaceForAction } from "@/lib/permissions";
import { actionError, NOT_ALLOWED, RATE_LIMITED, SAVE_FAILED, validationError, type ActionResult } from "@/lib/actionResult";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { FinanceError } from "@/lib/finance/tools/access";
import { saveExternalCodes } from "@/lib/finance/accounting-export";

/** Save the ledger codes the accounting exports use. Owners and admins only. */
export async function saveExternalCodesAction(slug: string, input: unknown): Promise<ActionResult<{ categories: number; accounts: number }>> {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `finance-mapping:${actor.user.id}`)) return actionError(RATE_LIMITED);
  try {
    const data = await saveExternalCodes(actor, input);
    revalidatePath(`/w/${actor.workspace.slug}/finance/export/accounting`);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof z.ZodError) return validationError(e);
    if (e instanceof FinanceError) return actionError(e.message);
    return actionError(SAVE_FAILED);
  }
}

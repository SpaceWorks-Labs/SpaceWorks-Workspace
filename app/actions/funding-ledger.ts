"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canManageFinance, canManageFunding } from "@/lib/roles";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { type ActionResult, NOT_ALLOWED, RATE_LIMITED, SAVE_FAILED, actionError, validationError } from "@/lib/actionResult";
import { FinanceError } from "@/lib/finance/tools/access";
import { FundingError } from "@/lib/funding/service";
import { recordDonationInLedger, recordDonationsInLedger, type BulkItem, type LinkResult } from "@/lib/funding/service/ledger-link";
import { createAssetFromInKind } from "@/lib/funding/service/ledger-link-inkind";

type Ctx = NonNullable<Awaited<ReturnType<typeof getWorkspaceForAction>>>;
async function run<T>(slug: string, fn: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  const ctx = await getWorkspaceForAction(slug, "ADMIN", { module: "finance" });
  if (!ctx || !canManageFunding(ctx.membership) || !canManageFinance(ctx.membership)) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  try {
    const data = await fn(ctx);
    for (const area of ["funding", "finance"]) revalidatePath(`/w/${ctx.workspace.slug}/${area}`, "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof z.ZodError) return validationError(e);
    if (e instanceof FundingError || e instanceof FinanceError) return actionError(e.message);
    return actionError(SAVE_FAILED);
  }
}

export async function recordDonationLedger(slug: string, raw: unknown): Promise<ActionResult<LinkResult>> {
  return run(slug, (ctx) => recordDonationInLedger(ctx, raw));
}
export async function recordDonationsLedger(slug: string, raw: unknown): Promise<ActionResult<BulkItem[]>> {
  return run(slug, (ctx) => recordDonationsInLedger(ctx, raw));
}
export async function createInKindAsset(slug: string, raw: unknown): Promise<ActionResult<{ assetId: string; created: boolean }>> {
  return run(slug, (ctx) => createAssetFromInKind(ctx, raw));
}

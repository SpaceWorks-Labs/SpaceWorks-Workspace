"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canManageFinance } from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { type ActionResult, NOT_ALLOWED, RATE_LIMITED, SAVE_FAILED, actionError, validationError } from "@/lib/actionResult";
import { lockFinance } from "@/lib/finance/tools/access";

async function guarded(slug: string) {
  const ctx = await getWorkspaceForAction(slug, "ADMIN", { module: "finance" });
  if (!ctx || !canManageFinance(ctx.membership)) return { error: NOT_ALLOWED } as const;
  if (await isActionRateLimited("action", ctx.user.id)) return { error: RATE_LIMITED } as const;
  return { ctx } as const;
}

export async function setFiscalYearStart(slug: string, month: unknown): Promise<ActionResult> {
  const g = await guarded(slug);
  if (g.error !== undefined) return actionError(g.error);
  const parsed = z.coerce.number().int().min(1, "Choose a month.").max(12, "Choose a month.").safeParse(month);
  if (!parsed.success) return validationError(parsed.error);
  const { ctx } = g;
  try {
    await prisma.$transaction(async (tx) => {
      await lockFinance(tx, ctx.workspace.id);
      await tx.workspace.update({ where: { id: ctx.workspace.id }, data: { fiscalYearStartMonth: parsed.data } });
      await recordAuditEvent({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, action: "finance.fiscal_year_changed", targetType: "workspace", targetId: ctx.workspace.id, metadata: { startMonth: parsed.data }, client: tx });
    });
    revalidatePath(`/w/${ctx.workspace.slug}/finance`, "layout");
    return { ok: true };
  } catch { return actionError(SAVE_FAILED); }
}

export async function setFundFcra(slug: string, fundId: unknown, fcra: unknown): Promise<ActionResult> {
  const g = await guarded(slug);
  if (g.error !== undefined) return actionError(g.error);
  const parsed = z.object({ fundId: z.string().trim().min(1).max(64), fcra: z.boolean() }).safeParse({ fundId, fcra });
  if (!parsed.success) return validationError(parsed.error);
  const { ctx } = g;
  try {
    const changed = await prisma.$transaction(async (tx) => {
      await lockFinance(tx, ctx.workspace.id);
      const result = await tx.financeFund.updateMany({ where: { id: parsed.data.fundId, workspaceId: ctx.workspace.id }, data: { fcra: parsed.data.fcra } });
      if (result.count) await recordAuditEvent({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, action: "finance.fund_fcra_changed", targetType: "fund", targetId: parsed.data.fundId, metadata: { fcra: parsed.data.fcra }, client: tx });
      return result.count;
    });
    if (!changed) return actionError("That fund is unavailable. Refresh and try again.");
    revalidatePath(`/w/${ctx.workspace.slug}/finance`, "layout");
    return { ok: true };
  } catch { return actionError(SAVE_FAILED); }
}

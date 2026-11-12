"use server";

import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { revalidatePath } from "@/lib/frontend/cache";
import { disconnectAccount, saveAccount, verifyAccount } from "@/lib/payments/accounts";
import { createInvoicePaymentLink, refundInvoicePayment } from "@/lib/payments/links";
import { canManageFinance, getWorkspaceForAction, type WorkspaceContext } from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";
import { idSchema } from "@/lib/validation";

/**
 * Payment Server Actions: slug → ADMIN with canManageFinance → rate limit →
 * zod → lib/payments (which scopes every query by workspaceId and audits).
 * Provider keys arrive here once and are never returned.
 */

const providerSchema = z.enum(["STRIPE", "RAZORPAY"]);
const field = z.string().max(300).optional().transform((value) => value ?? "");
const accountSchema = z.object({ provider: providerSchema, secretKey: field, webhookSecret: field, keyId: field, keySecret: field });

async function managerContext(slug: unknown, module: ModuleKey): Promise<WorkspaceContext | null> {
  const parsed = z.string().min(1).max(64).safeParse(slug);
  if (!parsed.success) return null;
  const ctx = await getWorkspaceForAction(parsed.data, "ADMIN", { module });
  return ctx && canManageFinance(ctx.membership) ? ctx : null;
}

const limited = (ctx: WorkspaceContext) => isActionRateLimited("apiWrite", `payments:${ctx.user.id}`);

async function guarded<T, R = undefined>(slug: string, input: unknown, schema: z.ZodType<T>, run: (ctx: WorkspaceContext, data: T) => Promise<ActionResult<R>>, module: ModuleKey = "core"): Promise<ActionResult<R>> {
  const ctx = await managerContext(slug, module);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await run(ctx, parsed.data);
  if (result.ok) {
    revalidatePath(`/w/${ctx.workspace.slug}/settings/payments`);
    revalidatePath(`/w/${ctx.workspace.slug}/finance/invoices`, "layout");
  }
  return result;
}

export async function savePaymentAccountAction(slug: string, input: unknown): Promise<ActionResult> {
  return guarded(slug, input, accountSchema, ({ workspace, user }, { provider, ...values }) => {
    const keys: Record<string, string> = provider === "STRIPE" ? { secretKey: values.secretKey, webhookSecret: values.webhookSecret } : { keyId: values.keyId, keySecret: values.keySecret, webhookSecret: values.webhookSecret };
    return saveAccount({ workspace, user }, provider, keys);
  });
}

export async function verifyPaymentAccountAction(slug: string, input: unknown): Promise<ActionResult> {
  return guarded(slug, input, z.object({ provider: providerSchema }), (ctx, { provider }) => verifyAccount(ctx, provider));
}

export async function disconnectPaymentAccountAction(slug: string, input: unknown): Promise<ActionResult> {
  return guarded(slug, input, z.object({ provider: providerSchema }), (ctx, { provider }) => disconnectAccount(ctx, provider));
}

export async function createInvoicePaymentLinkAction(slug: string, input: unknown): Promise<ActionResult<{ url: string }>> {
  return guarded(slug, input, z.object({ invoiceId: idSchema, provider: providerSchema }), (ctx, { invoiceId, provider }) => createInvoicePaymentLink(ctx, invoiceId, provider), "finance");
}

export async function refundInvoicePaymentAction(slug: string, input: unknown): Promise<ActionResult> {
  return guarded(slug, input, z.object({ paymentId: idSchema, amountMinor: z.number().int().min(1).max(2_147_483_647).optional() }), (ctx, { paymentId, amountMinor }) => refundInvoicePayment(ctx, paymentId, amountMinor), "finance");
}

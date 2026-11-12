import "server-only";
import type { PaymentProvider, Prisma } from "@prisma/client";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/permissions";
import {
  keyMode, liveKeysAllowed, openCredentials, PROVIDER_LABEL, PROVIDER_SEGMENT, razorpaySchema, sealCredentials, stripeSchema,
  type Credentials, type PaymentMode, type RazorpayCredentials, type StripeCredentials,
} from "./credentials";
import { verifyRazorpay } from "./razorpay";
import { verifyStripe } from "./stripe";

type Ctx = Pick<WorkspaceContext, "user" | "workspace">;
const MISSING = "That provider isn't connected. Connect it first.";

/** What the settings page may see. Credentials are never part of it. */
export type AccountView = {
  provider: PaymentProvider; label: string; mode: PaymentMode | null; status: string; lastVerifiedAt: string | null; lastError: string | null;
  hasWebhookSecret: boolean; webhookUrl: string;
};

export function webhookUrl(provider: PaymentProvider, token: string) {
  return `${(process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "")}/api/payments/${PROVIDER_SEGMENT[provider]}/${token}`;
}

export async function listAccounts(workspaceId: string): Promise<AccountView[]> {
  const rows = await prisma.paymentProviderAccount.findMany({ where: { workspaceId }, orderBy: { provider: "asc" } });
  return rows.map((row) => {
    const config = (row.config ?? {}) as { mode?: PaymentMode; hasWebhookSecret?: boolean };
    return { provider: row.provider, label: row.label, mode: config.mode ?? null, status: row.status, lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null, lastError: row.lastError, hasWebhookSecret: Boolean(config.hasWebhookSecret), webhookUrl: webhookUrl(row.provider, row.webhookToken) };
  });
}

/** Providers an invoice link can be created with (connected and active). */
export async function connectedProviders(workspaceId: string): Promise<PaymentProvider[]> {
  const rows = await prisma.paymentProviderAccount.findMany({ where: { workspaceId, status: "ACTIVE" }, select: { provider: true } });
  return rows.map((row) => row.provider);
}

/** Create or update an account. Blank secret fields keep the saved value; keys are write-only. */
export async function saveAccount(ctx: Ctx, provider: PaymentProvider, input: Record<string, string>): Promise<ActionResult> {
  const workspaceId = ctx.workspace.id;
  const existing = await prisma.paymentProviderAccount.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
  const saved = existing ? openCredentials(provider, existing.credentialsEnc) : null;
  const merged: Record<string, string> = { ...((saved as Record<string, string> | null) ?? {}) };
  for (const [key, value] of Object.entries(input)) if (value.trim()) merged[key] = value.trim();
  merged.webhookSecret ??= "";
  const parsed = (provider === "STRIPE" ? stripeSchema : razorpaySchema).safeParse(merged);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "_root");
    return actionError(parsed.error.issues[0]?.message ?? "Check the keys and try again.", { [field]: [parsed.error.issues[0]?.message ?? "Invalid value."] });
  }
  const credentials = parsed.data as Credentials;
  const mode = keyMode(provider, credentials);
  if (mode === "live" && !liveKeysAllowed()) return actionError("Live keys need this workspace to be served over https. Use test keys here, or fix the base URL first.");
  const keysChanged = !saved || (provider === "STRIPE" ? (credentials as StripeCredentials).secretKey !== (saved as StripeCredentials).secretKey : (credentials as RazorpayCredentials).keyId !== (saved as RazorpayCredentials).keyId || (credentials as RazorpayCredentials).keySecret !== (saved as RazorpayCredentials).keySecret);
  const data = { label: PROVIDER_LABEL[provider], credentialsEnc: sealCredentials(credentials), config: { mode, hasWebhookSecret: Boolean(credentials.webhookSecret) } as Prisma.InputJsonValue, status: "ACTIVE", ...(keysChanged ? { lastVerifiedAt: null, lastError: null } : {}) };
  await prisma.$transaction(async (tx) => {
    if (existing) await tx.paymentProviderAccount.update({ where: { id: existing.id }, data });
    else await tx.paymentProviderAccount.create({ data: { ...data, workspaceId, provider, webhookToken: randomToken(24), createdById: ctx.user.id } });
    await recordAuditEvent({ action: existing ? "payments.account_updated" : "payments.account_connected", workspaceId, actorId: ctx.user.id, targetType: "payment_account", targetId: provider, metadata: { provider, mode }, client: tx });
  });
  return { ok: true };
}

/** Ask the provider a harmless read question to prove the keys work. */
export async function verifyAccount(ctx: Ctx, provider: PaymentProvider): Promise<ActionResult> {
  const workspaceId = ctx.workspace.id;
  const account = await prisma.paymentProviderAccount.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
  const credentials = account ? openCredentials(provider, account.credentialsEnc) : null;
  if (!account || !credentials) return actionError(MISSING);
  const result = provider === "STRIPE" ? await verifyStripe(credentials as StripeCredentials) : await verifyRazorpay(credentials as RazorpayCredentials);
  await prisma.paymentProviderAccount.update({ where: { id: account.id }, data: result.ok ? { lastVerifiedAt: new Date(), lastError: null } : { lastError: result.error.slice(0, 300) } });
  await recordAuditEvent({ action: "payments.account_verified", workspaceId, actorId: ctx.user.id, targetType: "payment_account", targetId: provider, metadata: { provider, ok: result.ok } });
  return result.ok ? { ok: true } : actionError(`${PROVIDER_LABEL[provider]} didn't accept those keys. ${result.error}`);
}

export async function disconnectAccount(ctx: Ctx, provider: PaymentProvider): Promise<ActionResult> {
  const workspaceId = ctx.workspace.id;
  const removed = await prisma.$transaction(async (tx) => {
    const deleted = await tx.paymentProviderAccount.deleteMany({ where: { workspaceId, provider } });
    if (deleted.count) await recordAuditEvent({ action: "payments.account_disconnected", workspaceId, actorId: ctx.user.id, targetType: "payment_account", targetId: provider, metadata: { provider }, client: tx });
    return deleted.count;
  });
  return removed ? { ok: true } : actionError(MISSING);
}
